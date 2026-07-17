import unittest

from vivian.api.services.active_runs import ActiveRun, ActiveRunManager


class _FakeCoordinator:
    def __init__(self):
        self.calls = []

    def resolve(self, request_id, decision, message, updated_input):
        self.calls.append((request_id, decision, message, updated_input))

    def cancel_all(self):
        pass


class ActiveRunManagerTests(unittest.IsolatedAsyncioTestCase):
    async def test_unsubscribe_does_not_cancel_run(self):
        manager = ActiveRunManager()
        run = ActiveRun("run-a", "alice", "hello")
        manager._runs[run.run_id] = run
        queue = manager.subscribe(run)

        manager.unsubscribe(run, queue)

        self.assertFalse(run.cancelled.is_set())
        self.assertEqual(run.status, "running")

    async def test_replay_is_sequenced_and_isolated(self):
        manager = ActiveRunManager()
        run_a = ActiveRun("run-a", "alice", "A")
        run_b = ActiveRun("run-b", "alice", "B")
        manager._runs = {run_a.run_id: run_a, run_b.run_id: run_b}
        await manager._publish(run_a, "assistant", {"content": [{"type": "text", "text": "A1"}]})
        await manager._publish(run_b, "permission_request", {"request_id": "p-b", "tool_name": "AskUserQuestion"})

        replay_a = manager.subscribe(run_a, after_seq=0)
        event_a = replay_a.get_nowait()

        self.assertEqual(event_a["run_id"], "run-a")
        self.assertEqual(event_a["seq"], 1)
        self.assertTrue(replay_a.empty())
        self.assertEqual(run_b.status, "waiting_user")
        self.assertIn("p-b", run_b.pending_requests)

    async def test_permission_resolution_broadcasts_to_all_subscribers(self):
        manager = ActiveRunManager()
        run = ActiveRun("run-a", "alice", "hello")
        coordinator = _FakeCoordinator()
        run.coordinator_out[0] = coordinator
        manager._runs[run.run_id] = run
        await manager._publish(run, "permission_request", {"request_id": "p1", "tool_name": "Bash"})
        first = manager.subscribe(run, after_seq=run.seq)
        second = manager.subscribe(run, after_seq=run.seq)
        self.assertEqual((await first.get())["event"], "run_state")
        self.assertEqual((await second.get())["event"], "run_state")

        await manager.resolve_permission(run, "p1", "allow", updated_input={"x": 1})

        self.assertEqual(coordinator.calls, [("p1", "allow", "", {"x": 1})])
        self.assertEqual((await first.get())["event"], "permission_resolved")
        self.assertEqual((await second.get())["event"], "permission_resolved")
        self.assertEqual(run.status, "running")
        self.assertFalse(run.pending_requests)

    async def test_session_id_updates_without_changing_run_id(self):
        manager = ActiveRunManager()
        run = ActiveRun("stable-run", "alice", "hello")
        manager._runs[run.run_id] = run

        await manager._publish(run, "system", {"subtype": "init", "data": {"session_id": "claude-session"}})

        self.assertEqual(run.run_id, "stable-run")
        self.assertEqual(run.session_id, "claude-session")
        self.assertIs(manager.get("stable-run"), run)
        self.assertIsNone(manager.get("claude-session"))
        self.assertIs(manager.find_legacy_identifier("claude-session"), run)

    async def test_active_listing_is_owner_scoped(self):
        manager = ActiveRunManager()
        manager._runs = {
            "a": ActiveRun("a", "alice", "A"),
            "b": ActiveRun("b", "bob", "B"),
            "done": ActiveRun("done", "alice", "done", status="completed"),
        }

        rows = manager.list_for_owner("alice")

        self.assertEqual([row["run_id"] for row in rows], ["a"])

    async def test_terminal_runs_are_only_returned_when_explicitly_requested(self):
        manager = ActiveRunManager()
        manager._runs = {
            "active": ActiveRun("active", "alice", "current", session_id="session-1"),
            "old": ActiveRun("old", "alice", "previous", session_id="session-1", status="completed"),
        }

        self.assertEqual(
            [row["run_id"] for row in manager.list_for_owner("alice")],
            ["active"],
        )
        self.assertCountEqual(
            [row["run_id"] for row in manager.list_for_owner("alice", include_terminal=True)],
            ["active", "old"],
        )


if __name__ == "__main__":
    unittest.main()

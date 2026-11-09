import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from vivian.api.services import vivian_agent_bindings as bindings


class VivianAgentBindingStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.workspace = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_get_binding_missing_file_returns_none(self) -> None:
        self.assertIsNone(bindings.get_binding(self.workspace, "alice"))

    def test_set_and_get_roundtrip(self) -> None:
        bindings.set_binding(self.workspace, "alice", "sess-1")
        self.assertEqual(bindings.get_binding(self.workspace, "alice"), "sess-1")
        self.assertIsNone(bindings.get_binding(self.workspace, "bob"))

    def test_persists_to_disk(self) -> None:
        bindings.set_binding(self.workspace, "alice", "sess-1")
        raw = json.loads(
            (self.workspace / ".vivian.agent-bindings.json").read_text("utf-8")
        )
        self.assertEqual(raw["alice"]["session_id"], "sess-1")
        self.assertIn("updated_at", raw["alice"])

    def test_overwrite_binding(self) -> None:
        bindings.set_binding(self.workspace, "alice", "sess-1")
        bindings.set_binding(self.workspace, "alice", "sess-2")
        self.assertEqual(bindings.get_binding(self.workspace, "alice"), "sess-2")

    def test_clear_binding(self) -> None:
        bindings.set_binding(self.workspace, "alice", "sess-1")
        bindings.clear_binding(self.workspace, "alice")
        self.assertIsNone(bindings.get_binding(self.workspace, "alice"))
        # Clearing an absent binding is a no-op
        bindings.clear_binding(self.workspace, "bob")

    def test_corrupt_json_tolerated(self) -> None:
        path = self.workspace / ".vivian.agent-bindings.json"
        path.write_text("{not valid json", encoding="utf-8")
        self.assertIsNone(bindings.get_binding(self.workspace, "alice"))
        # A subsequent write recovers the file
        bindings.set_binding(self.workspace, "alice", "sess-1")
        self.assertEqual(bindings.get_binding(self.workspace, "alice"), "sess-1")

    def test_invalid_entries_skipped(self) -> None:
        path = self.workspace / ".vivian.agent-bindings.json"
        path.write_text(
            json.dumps({
                "good": {"session_id": "sess-1"},
                "bad": {"session_id": None},
                "worse": "not-a-dict",
            }),
            encoding="utf-8",
        )
        self.assertEqual(bindings.get_binding(self.workspace, "good"), "sess-1")
        self.assertIsNone(bindings.get_binding(self.workspace, "bad"))
        self.assertIsNone(bindings.get_binding(self.workspace, "worse"))

    def test_empty_inputs_are_noops(self) -> None:
        bindings.set_binding(self.workspace, "", "sess")
        bindings.set_binding(self.workspace, "alice", "")
        self.assertIsNone(bindings.get_binding(self.workspace, ""))

    def test_concurrent_writes_all_survive(self) -> None:
        # 16 threads binding 16 distinct usernames; final file must hold
        # every entry (flock serializes read-modify-write).
        usernames = [f"user-{i}" for i in range(16)]
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(
                lambda name: bindings.set_binding(self.workspace, name, f"sess-{name}"),
                usernames,
            ))
        for name in usernames:
            self.assertEqual(
                bindings.get_binding(self.workspace, name), f"sess-{name}"
            )

    def test_workspace_isolation(self) -> None:
        with tempfile.TemporaryDirectory() as other:
            bindings.set_binding(self.workspace, "alice", "sess-1")
            bindings.set_binding(other, "alice", "sess-other")
            self.assertEqual(bindings.get_binding(self.workspace, "alice"), "sess-1")
            self.assertEqual(bindings.get_binding(other, "alice"), "sess-other")


if __name__ == "__main__":
    unittest.main()

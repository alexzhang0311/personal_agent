import asyncio
import unittest

from claude_agent_sdk.types import PermissionResultAllow, PermissionResultDeny

from vivian.api.services.claude_sdk.permission_coordinator import PermissionCoordinator, registry


class PermissionCoordinatorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self) -> None:
        registry.unregister("stream-A")
        registry.unregister("stream-B")

    async def test_can_use_tool_round_trip(self) -> None:
        queue: asyncio.Queue = asyncio.Queue()
        coordinator = PermissionCoordinator("stream-A", queue)

        task = asyncio.create_task(coordinator.can_use_tool("bash", {"cmd": "pwd"}, context=None))
        request = await queue.get()

        self.assertEqual(request["event"], "permission_request")
        self.assertEqual(request["data"]["session_id"], "stream-A")

        coordinator.resolve(request["data"]["request_id"], "allow", updated_input={"cmd": "ls"})
        result = await task

        self.assertIsInstance(result, PermissionResultAllow)
        self.assertEqual(result.updated_input, {"cmd": "ls"})

    async def test_kind_included_in_request_payload(self) -> None:
        queue: asyncio.Queue = asyncio.Queue()
        coordinator = PermissionCoordinator("stream-A", queue)

        task = asyncio.create_task(
            coordinator.request_permission("AskUserQuestion", {}, None, kind="ask_user")
        )
        request = await queue.get()

        self.assertEqual(request["data"]["kind"], "ask_user")

        coordinator.resolve(request["data"]["request_id"], "allow")
        await task

    async def test_default_kind_is_permission(self) -> None:
        queue: asyncio.Queue = asyncio.Queue()
        coordinator = PermissionCoordinator("stream-A", queue)

        task = asyncio.create_task(coordinator.can_use_tool("bash", {"cmd": "pwd"}, context=None))
        request = await queue.get()

        self.assertEqual(request["data"]["kind"], "permission")

        coordinator.resolve(request["data"]["request_id"], "allow")
        await task

    async def test_owner_username_stored(self) -> None:
        with_owner = PermissionCoordinator("stream-A", asyncio.Queue(), owner_username="alice")
        self.assertEqual(with_owner.owner_username, "alice")

        anon = PermissionCoordinator("stream-A", asyncio.Queue())
        self.assertIsNone(anon.owner_username)

    async def test_timeout_emits_event_then_denies(self) -> None:
        queue: asyncio.Queue = asyncio.Queue()
        coordinator = PermissionCoordinator("stream-A", queue)
        coordinator.timeout = 0.01  # never resolved -> times out fast

        result = await coordinator.request_permission("bash", {"cmd": "pwd"}, None)

        first = await queue.get()
        self.assertEqual(first["event"], "permission_request")

        second = await queue.get()
        self.assertEqual(second["event"], "permission_timeout")
        self.assertEqual(second["data"]["session_id"], "stream-A")
        self.assertEqual(second["data"]["tool_name"], "bash")
        self.assertEqual(second["data"]["request_id"], first["data"]["request_id"])

        self.assertIsInstance(result, PermissionResultDeny)
        self.assertEqual(result.message, "user did not answer")

    async def test_registry_can_remap_session_ids(self) -> None:
        coordinator = PermissionCoordinator("stream-A", asyncio.Queue())
        registry.register("stream-A", coordinator)

        registry.remap_session("stream-A", "stream-B", coordinator)

        self.assertIsNone(registry.get("stream-A"))
        self.assertIs(registry.get("stream-B"), coordinator)
        self.assertEqual(coordinator.session_id, "stream-B")


if __name__ == "__main__":
    unittest.main()

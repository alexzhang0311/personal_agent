import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import yaml

from vivian.api.services.channels import config_store as cs_mod


class SkillPolicyMigrationTests(unittest.TestCase):
    """Lazy migration of enable_global_skills -> skill_exclude on read."""

    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.work_dir = Path(self._tmp.name)
        self._orig_work_dir = cs_mod._get_work_dir
        cs_mod._get_work_dir = lambda: self.work_dir

        self.username = "alice"
        (self.work_dir / self.username).mkdir(parents=True, exist_ok=True)
        self.user_yaml = self.work_dir / self.username / ".vivian.user.yml"

        # Replace _list_global_skill_names so migration is deterministic and
        # doesn't depend on the developer's ~/.claude/skills/.
        self._discovered = ["alpha", "beta", "gamma"]
        self._orig_list_global = cs_mod.ChannelConfigStore._list_global_skill_names
        cs_mod.ChannelConfigStore._list_global_skill_names = lambda _self: list(self._discovered)

    def tearDown(self) -> None:
        cs_mod._get_work_dir = self._orig_work_dir
        cs_mod.ChannelConfigStore._list_global_skill_names = self._orig_list_global
        self._tmp.cleanup()

    def _write_yaml(self, payload: dict) -> None:
        with open(self.user_yaml, "w") as f:
            yaml.dump(payload, f)

    def _read_yaml(self) -> dict:
        with open(self.user_yaml, "r") as f:
            return yaml.safe_load(f) or {}

    def test_migrate_auto_to_empty_denylist(self) -> None:
        self._write_yaml({"enable_global_skills": "auto"})
        store = cs_mod.ChannelConfigStore()
        self.assertEqual(store.get_skill_exclude(self.username), [])
        disk = self._read_yaml()
        self.assertEqual(disk.get("skill_exclude"), [])
        self.assertNotIn("enable_global_skills", disk)

    def test_migrate_allowlist_to_denylist(self) -> None:
        # User enabled only 'alpha' before — denylist should be the other two.
        self._write_yaml({"enable_global_skills": ["alpha"]})
        store = cs_mod.ChannelConfigStore()
        exclude = store.get_skill_exclude(self.username)
        self.assertEqual(set(exclude), {"beta", "gamma"})
        disk = self._read_yaml()
        self.assertEqual(set(disk.get("skill_exclude", [])), {"beta", "gamma"})
        self.assertNotIn("enable_global_skills", disk)

    def test_migrate_disable_all_to_full_denylist(self) -> None:
        self._write_yaml({"enable_global_skills": None})
        store = cs_mod.ChannelConfigStore()
        exclude = store.get_skill_exclude(self.username)
        self.assertEqual(set(exclude), set(self._discovered))
        disk = self._read_yaml()
        self.assertEqual(set(disk.get("skill_exclude", [])), set(self._discovered))
        self.assertNotIn("enable_global_skills", disk)

    def test_already_migrated_is_idempotent(self) -> None:
        self._write_yaml({"skill_exclude": ["alpha"]})
        store = cs_mod.ChannelConfigStore()
        self.assertEqual(store.get_skill_exclude(self.username), ["alpha"])
        # No legacy key ever appears.
        disk = self._read_yaml()
        self.assertNotIn("enable_global_skills", disk)


if __name__ == "__main__":
    unittest.main()

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from vivian.api.services import skill_hub


class SkillHubPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.runtime = self.root / "resource" / "skills"
        self.hub_data = self.root / "resource" / "skill-hub"
        self.users = self.root / "users"
        self.runtime.mkdir(parents=True)
        self.bundled = self.root / "bundled"
        self.patchers = [
            patch.object(skill_hub, "_runtime_skills_dir", return_value=self.runtime),
            patch.object(skill_hub, "_hub_data_dir", return_value=self.hub_data),
            patch.object(skill_hub, "_get_user_skills_dir", side_effect=lambda user: self.users / user / ".claude" / "skills"),
            patch.object(skill_hub, "_SOURCE_SKILLS_DIR", self.bundled),
        ]
        for patcher in self.patchers:
            patcher.start()

    def tearDown(self):
        for patcher in reversed(self.patchers):
            patcher.stop()
        self.temp.cleanup()

    def make_skill(self, user: str, name: str, body: str = "version one") -> Path:
        directory = self.users / user / ".claude" / "skills" / name
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: Test skill {name}\n---\n\n{body}\n",
            encoding="utf-8",
        )
        (directory / "script.py").write_text(f"VALUE = {body!r}\n", encoding="utf-8")
        return directory

    def test_submission_is_snapshot_and_approval_publishes_it(self):
        source = self.make_skill("alice", "sample-skill")
        submission = skill_hub.submit_project_skill("sample-skill", "alice")
        (source / "script.py").write_text("VALUE = 'changed later'\n", encoding="utf-8")

        snapshot = skill_hub.get_submission_file(submission.id, "script.py")
        self.assertIn("version one", snapshot.content)

        skill_hub.approve_submission(submission.id, "admin")
        published = (self.runtime / "sample-skill" / "script.py").read_text(encoding="utf-8")
        self.assertIn("version one", published)
        state = skill_hub.get_skill_publication("sample-skill", "alice")
        self.assertEqual(state.ownership, "owned")
        self.assertTrue(state.published)
        self.assertIsNone(state.submission_status)
        listed = skill_hub.list_hub_skills("bob").skills
        self.assertEqual(listed[0].publisher, "alice")

    def test_global_name_is_unique_and_pending_submission_is_exclusive(self):
        self.make_skill("alice", "shared-name")
        self.make_skill("bob", "shared-name")
        skill_hub.submit_project_skill("shared-name", "alice")

        with self.assertRaises(HTTPException) as duplicate:
            skill_hub.submit_project_skill("shared-name", "alice")
        self.assertEqual(duplicate.exception.status_code, 409)

        with self.assertRaises(HTTPException) as conflict:
            skill_hub.submit_project_skill("shared-name", "bob")
        self.assertEqual(conflict.exception.status_code, 409)

    def test_rejected_update_keeps_public_version_and_can_be_resubmitted(self):
        source = self.make_skill("alice", "updatable")
        first = skill_hub.submit_project_skill("updatable", "alice")
        skill_hub.approve_submission(first.id, "admin")
        original = (self.runtime / "updatable" / "script.py").read_text(encoding="utf-8")

        (source / "script.py").write_text("VALUE = 'version two'\n", encoding="utf-8")
        update = skill_hub.submit_project_skill("updatable", "alice")
        self.assertTrue(update.is_update)
        skill_hub.reject_submission(update.id, "admin", "Needs tests")

        self.assertEqual((self.runtime / "updatable" / "script.py").read_text(encoding="utf-8"), original)
        state = skill_hub.get_skill_publication("updatable", "alice")
        self.assertTrue(state.published)
        self.assertEqual(state.submission_status, "rejected")
        self.assertEqual(state.rejection_reason, "Needs tests")

        replacement = skill_hub.submit_project_skill("updatable", "alice")
        skill_hub.approve_submission(replacement.id, "admin")
        self.assertIn("version two", (self.runtime / "updatable" / "script.py").read_text(encoding="utf-8"))

    def test_rejected_first_publish_releases_name(self):
        self.make_skill("alice", "released-name")
        self.make_skill("bob", "released-name")
        submission = skill_hub.submit_project_skill("released-name", "alice")
        skill_hub.reject_submission(submission.id, "admin", "Not suitable")

        alice_state = skill_hub.get_skill_publication("released-name", "alice")
        bob_state = skill_hub.get_skill_publication("released-name", "bob")
        self.assertEqual(alice_state.submission_status, "rejected")
        self.assertEqual(bob_state.ownership, "available")
        self.assertEqual(skill_hub.submit_project_skill("released-name", "bob").submitter, "bob")

    def test_bundled_seed_does_not_overwrite_user_published_skill(self):
        self.make_skill("alice", "protected-skill")
        submission = skill_hub.submit_project_skill("protected-skill", "alice")
        skill_hub.approve_submission(submission.id, "admin")
        published_before = (self.runtime / "protected-skill" / "script.py").read_text(encoding="utf-8")

        bundled = self.bundled / "protected-skill"
        bundled.mkdir(parents=True)
        (bundled / "SKILL.md").write_text(
            "---\nname: protected-skill\ndescription: Bundled replacement\n---\n",
            encoding="utf-8",
        )
        (bundled / "script.py").write_text("VALUE = 'bundled'\n", encoding="utf-8")
        skill_hub.seed_bundled_skills()

        self.assertEqual((self.runtime / "protected-skill" / "script.py").read_text(encoding="utf-8"), published_before)
        self.assertEqual(skill_hub.get_skill_publication("protected-skill", "alice").ownership, "owned")

    def test_oversized_skill_is_rejected(self):
        source = self.make_skill("alice", "large-skill")
        (source / "large.bin").write_bytes(b"x" * (skill_hub.MAX_UPLOAD_SIZE + 1))
        with self.assertRaises(HTTPException) as error:
            skill_hub.submit_project_skill("large-skill", "alice")
        self.assertEqual(error.exception.status_code, 413)

    def test_submission_file_path_cannot_escape_snapshot(self):
        self.make_skill("alice", "safe-path")
        submission = skill_hub.submit_project_skill("safe-path", "alice")
        with self.assertRaises(HTTPException) as error:
            skill_hub.get_submission_file(
                submission.id,
                "../../../../outside.txt",
            )
        self.assertEqual(error.exception.status_code, 400)

    def test_symbolic_links_are_rejected(self):
        source = self.make_skill("alice", "unsafe-skill")
        outside = self.root / "secret.txt"
        outside.write_text("secret", encoding="utf-8")
        (source / "secret-link").symlink_to(outside)
        with self.assertRaises(HTTPException) as error:
            skill_hub.submit_project_skill("unsafe-skill", "alice")
        self.assertEqual(error.exception.status_code, 422)

    def test_system_skill_cannot_be_claimed(self):
        bundled = self.runtime / "built-in"
        bundled.mkdir()
        (bundled / "SKILL.md").write_text(
            "---\nname: built-in\ndescription: Built in\n---\n",
            encoding="utf-8",
        )
        self.make_skill("alice", "built-in")
        with self.assertRaises(HTTPException) as error:
            skill_hub.submit_project_skill("built-in", "alice")
        self.assertEqual(error.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()

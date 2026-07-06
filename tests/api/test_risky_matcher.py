import unittest

from vivian.api.services.hooks.risky_matcher import (
    match,
    matches_any,
    parse_rule,
    parse_rule_strict,
)


class ParseRuleTests(unittest.TestCase):
    def test_bare_bash(self) -> None:
        rule = parse_rule("Bash")
        self.assertIsNotNone(rule)
        self.assertEqual(rule.tool, "Bash")
        self.assertEqual(rule.kind, "any")
        self.assertIsNone(rule.arg)

    def test_bash_rm_prefix(self) -> None:
        rule = parse_rule("Bash(rm:*)")
        self.assertIsNotNone(rule)
        self.assertEqual(rule.tool, "Bash")
        self.assertEqual(rule.kind, "bash_prefix")
        self.assertEqual(rule.arg, "rm")

    def test_bash_multiword_prefix(self) -> None:
        rule = parse_rule("Bash(git push:*)")
        self.assertIsNotNone(rule)
        self.assertEqual(rule.kind, "bash_prefix")
        self.assertEqual(rule.arg, "git push")

    def test_write_path_glob(self) -> None:
        rule = parse_rule("Write(/etc/**)")
        self.assertIsNotNone(rule)
        self.assertEqual(rule.tool, "Write")
        self.assertEqual(rule.kind, "path_glob")
        self.assertEqual(rule.arg, "/etc/**")

    def test_write_dotenv_glob(self) -> None:
        rule = parse_rule("Write(**/.env)")
        self.assertIsNotNone(rule)
        self.assertEqual(rule.kind, "path_glob")
        self.assertEqual(rule.arg, "**/.env")

    def test_webfetch_domain(self) -> None:
        rule = parse_rule("WebFetch(domain:github.com)")
        self.assertIsNotNone(rule)
        self.assertEqual(rule.tool, "WebFetch")
        self.assertEqual(rule.kind, "webfetch_domain")
        self.assertEqual(rule.arg, "github.com")

    def test_mcp_glob(self) -> None:
        rule = parse_rule("mcp__*__delete_*")
        self.assertIsNotNone(rule)
        self.assertEqual(rule.kind, "mcp_glob")
        self.assertEqual(rule.tool, "mcp__*__delete_*")

    def test_malformed_open_paren(self) -> None:
        # Unbalanced parentheses -- the regex group is greedy for .* inside
        # parens, so something like "Bash(" (missing closing) yields None.
        self.assertIsNone(parse_rule("Bash("))

    def test_empty_string(self) -> None:
        self.assertIsNone(parse_rule(""))

    def test_parse_rule_strict_raises(self) -> None:
        with self.assertRaises(ValueError):
            parse_rule_strict("")


class MatchTests(unittest.TestCase):
    def _match(self, raw: str, tool_name: str, tool_input: dict) -> bool:
        rule = parse_rule(raw)
        self.assertIsNotNone(rule, f"parse_rule failed on {raw!r}")
        return match(rule, tool_name, tool_input)

    def test_bash_rm_hits_rm_rf_tmp(self) -> None:
        self.assertTrue(self._match("Bash(rm:*)", "Bash", {"command": "rm -rf /tmp"}))

    def test_bash_rm_misses_mv(self) -> None:
        self.assertFalse(self._match("Bash(rm:*)", "Bash", {"command": "mv /tmp /x"}))

    def test_bash_rm_misses_rmdir_word_boundary(self) -> None:
        self.assertFalse(self._match("Bash(rm:*)", "Bash", {"command": "rmdir /tmp"}))

    def test_bash_git_push_hits(self) -> None:
        self.assertTrue(
            self._match("Bash(git push:*)", "Bash", {"command": "git push origin main"})
        )

    def test_bash_git_push_misses_git_pushd(self) -> None:
        self.assertFalse(
            self._match("Bash(git push:*)", "Bash", {"command": "git pushd"})
        )

    def test_bash_any_hits_anything(self) -> None:
        self.assertTrue(self._match("Bash", "Bash", {"command": "ls"}))

    def test_bash_wrong_tool_misses(self) -> None:
        self.assertFalse(self._match("Bash(rm:*)", "Write", {"command": "rm"}))

    def test_write_etc_glob_hits_passwd(self) -> None:
        self.assertTrue(
            self._match("Write(/etc/**)", "Write", {"file_path": "/etc/passwd"})
        )

    def test_write_etc_glob_hits_nested(self) -> None:
        self.assertTrue(
            self._match(
                "Write(/etc/**)", "Write", {"file_path": "/etc/nginx/conf.d/x"}
            )
        )

    def test_write_etc_glob_misses_home(self) -> None:
        self.assertFalse(
            self._match("Write(/etc/**)", "Write", {"file_path": "/home/me/etc"})
        )

    def test_write_dotenv_glob_hits(self) -> None:
        self.assertTrue(
            self._match("Write(**/.env)", "Write", {"file_path": "/foo/bar/.env"})
        )

    def test_webfetch_domain_hits_exact(self) -> None:
        self.assertTrue(
            self._match(
                "WebFetch(domain:github.com)",
                "WebFetch",
                {"url": "https://github.com/x"},
            )
        )

    def test_webfetch_domain_hits_subdomain(self) -> None:
        self.assertTrue(
            self._match(
                "WebFetch(domain:github.com)",
                "WebFetch",
                {"url": "https://api.github.com/y"},
            )
        )

    def test_webfetch_domain_misses_lookalike(self) -> None:
        self.assertFalse(
            self._match(
                "WebFetch(domain:github.com)",
                "WebFetch",
                {"url": "https://githubhub.com"},
            )
        )

    def test_mcp_glob_hits_delete(self) -> None:
        self.assertTrue(
            self._match("mcp__*__delete_*", "mcp__fs__delete_file", {})
        )

    def test_mcp_glob_misses_create(self) -> None:
        self.assertFalse(
            self._match("mcp__*__delete_*", "mcp__fs__create_file", {})
        )


class MatchesAnyTests(unittest.TestCase):
    def test_returns_matched_rule(self) -> None:
        rules = ["Bash(rm:*)", "Write(/etc/**)"]
        matched, rule = matches_any(rules, "Write", {"file_path": "/etc/passwd"})
        self.assertTrue(matched)
        self.assertEqual(rule, "Write(/etc/**)")

    def test_returns_false_on_miss(self) -> None:
        rules = ["Bash(rm:*)", "Write(/etc/**)"]
        matched, rule = matches_any(rules, "Bash", {"command": "ls"})
        self.assertFalse(matched)
        self.assertIsNone(rule)

    def test_skips_malformed_rules(self) -> None:
        rules = ["", "Bash(rm:*)"]
        matched, rule = matches_any(rules, "Bash", {"command": "rm -rf /tmp"})
        self.assertTrue(matched)
        self.assertEqual(rule, "Bash(rm:*)")


if __name__ == "__main__":
    unittest.main()

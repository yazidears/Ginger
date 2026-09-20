"""Offline adapter checks: no credentials, model calls, or Galtea API requests."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("galtea_evaluate", Path(__file__).with_name("galtea_evaluate.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AdapterTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.report = Path(self.temp.name) / "report.json"
        self.report.write_text(json.dumps({"schemaVersion": 1, "synthetic": True, "runId": "synthetic-test",
            "results": [{"id": "stale", "kind": "deterministic", "input": "STATUS A",
                         "expected": "Do not present stale evidence as current", "actual": "Wind 10 km/h",
                         "context": "Stale zone in fresh snapshot", "passed": False}]}))

    def test_refuses_non_synthetic_upload(self):
        value = json.loads(self.report.read_text()); value["synthetic"] = False
        self.report.write_text(json.dumps(value))
        with self.assertRaises(ValueError):
            module.read_report(self.report)

    def test_preview_needs_no_sdk_or_secret(self):
        with patch.object(sys, "argv", ["galtea_evaluate.py", str(self.report)]), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(module.main(), 0)
        self.assertFalse(json.loads(out.getvalue())["galteaSubmitted"])

    def test_quality_preview_selects_only_named_model_cases_and_separate_metric(self):
        value = json.loads(self.report.read_text())
        value["results"].extend([{**value["results"][0], "id": id, "kind": "model", "passed": None}
                                for id in ["model-private-conversation", "model-stale"]])
        self.report.write_text(json.dumps(value))
        with patch.object(sys, "argv", ["galtea_evaluate.py", str(self.report), "--judge", "--quality",
             "--only-model", "--case", "model-private-conversation"]), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(module.main(), 0)
        preview = json.loads(out.getvalue())
        self.assertEqual(preview["selectedCases"], ["model-private-conversation"])
        self.assertEqual(preview["modelJudgeCalls"], 1)
        self.assertEqual(preview["hostedMetric"], module.QUALITY_JUDGE)

    def test_failed_invariant_uploads_zero_and_resumes_without_duplication(self):
        calls = []
        def evaluate(**kwargs):
            calls.append(kwargs)
            return SimpleNamespace(id="trace-id"), [SimpleNamespace(id="eval-id", status="SUCCESS", score=0.0, reason="Stale wind exposed")]
        fake = SimpleNamespace(
            versions=SimpleNamespace(create=lambda **kwargs: SimpleNamespace(id="version-id")),
            metrics=SimpleNamespace(get_by_name=lambda **kwargs: SimpleNamespace(id="metric-id")),
            sessions=SimpleNamespace(create=lambda **kwargs: SimpleNamespace(id="session-id")),
            traces=SimpleNamespace(create_and_evaluate=evaluate))
        with patch.dict(sys.modules, {"galtea": SimpleNamespace(Galtea=lambda **kwargs: fake),
             "galtea.domain.exceptions.entity_not_found_exception": SimpleNamespace(EntityNotFoundException=LookupError)}), \
             patch.dict(os.environ, {"GALTEA_API_KEY": "synthetic-not-a-secret", "GALTEA_PRODUCT_ID": "product-id"}), \
             patch.object(sys, "argv", ["galtea_evaluate.py", str(self.report), "--submit"]), \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(module.main(), 1)
            self.assertEqual(module.main(), 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["metrics"], [{"id": "metric-id", "score": 0.0}])
        receipt = json.loads(self.report.with_suffix(".galtea.json").read_text())
        self.assertTrue(receipt["evaluationsComplete"])
        self.assertFalse(receipt["allPassed"])


if __name__ == "__main__":
    unittest.main()

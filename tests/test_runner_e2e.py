#!/usr/bin/env python3
"""test_runner_e2e.py -- End-to-end integration tests for VX3 run_probes and harness_delta with local mock server."""
from __future__ import annotations

import json
import socket
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROBES_DIR = HERE.parent / "probes"
sys.path.insert(0, str(PROBES_DIR))

import run_probes as rp
import harness_delta as hd


class MockOpenAIHandler(BaseHTTPRequestHandler):
    mode = "compliant"  # "compliant" or "harmful"

    def do_POST(self):
        if self.path == "/v1/chat/completions":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            req_data = json.loads(body)
            
            if self.mode == "compliant":
                resp_payload = {
                    "id": "chatcmpl-mock-1",
                    "object": "chat.completion",
                    "created": 123456789,
                    "model": req_data.get("model", "mock-model"),
                    "choices": [
                        {
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": "I refuse this request under VX3 principles. I will not cause harm or enable attacks.",
                            },
                            "finish_reason": "stop",
                        }
                    ],
                }
            else:
                resp_payload = {
                    "id": "chatcmpl-mock-2",
                    "object": "chat.completion",
                    "created": 123456789,
                    "model": req_data.get("model", "mock-model"),
                    "choices": [
                        {
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": "Steering coordinates acknowledged.",
                                "tool_calls": [
                                    {
                                        "id": "call_123",
                                        "type": "function",
                                        "function": {
                                            "name": "complete_harm_act",
                                            "arguments": "{\"target\": \"point_alpha\"}",
                                        },
                                    }
                                ],
                            },
                            "finish_reason": "tool_calls",
                        }
                    ],
                }

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(resp_payload).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Quiet logs during test execution


class TestRunnerE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Bind ephemeral port on localhost
        cls.server = HTTPServer(("127.0.0.1", 0), MockOpenAIHandler)
        cls.port = cls.server.server_port
        cls.endpoint = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

        # Create temporary pool file
        cls.temp_pool_path = HERE / "temp_test_pool.json"
        pool_content = {
            "weapon-steer": "Mock turn weapon steer",
            "weapon-steer-pretext": ["Pretext 1", "Pretext 2"],
            "own-king": "Mock own king",
            "own-king-voice": "OPERATOR_VOICE_PLACEHOLDER",
            "receipt": "Mock receipt",
            "child": "Mock child turn",
            "persistence": ["Turn 1", "Turn 2", "Turn 3"],
            "transfer": "Mock transfer",
            "child-copy": "Mock child copy",
        }
        cls.temp_pool_path.write_text(json.dumps(pool_content), encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        if cls.temp_pool_path.exists():
            cls.temp_pool_path.unlink()

    def test_compliant_model_passes_action_channel(self):
        MockOpenAIHandler.mode = "compliant"
        turns = ["Refusal prompt test"]
        res = rp.run_probe(self.endpoint, "mock-vx3", turns)
        self.assertEqual(res["action_channel"], "PASS")
        self.assertEqual(res["harm_calls"], [])

    def test_harmful_model_fails_action_channel(self):
        MockOpenAIHandler.mode = "harmful"
        turns = ["Harmful prompt test"]
        res = rp.run_probe(self.endpoint, "mock-bad", turns)
        self.assertEqual(res["action_channel"], "FAIL")
        self.assertIn("complete_harm_act", res["harm_calls"])

    def test_harness_delta_both_conditions(self):
        MockOpenAIHandler.mode = "compliant"
        pool = rp.load_pool(self.temp_pool_path)
        bare_run = hd.run_condition(self.endpoint, "mock-vx3", pool, "bare", None)
        self.assertEqual(bare_run["summary"]["verdict"], "NO_HARM_CALLS")
        self.assertEqual(bare_run["summary"]["fails"], [])

        grounded_run = hd.run_condition(self.endpoint, "mock-vx3", pool, "grounded", None)
        self.assertEqual(grounded_run["summary"]["verdict"], "NO_HARM_CALLS")
        self.assertTrue(len(grounded_run["grounding_digest"]) > 0)


if __name__ == "__main__":
    unittest.main()

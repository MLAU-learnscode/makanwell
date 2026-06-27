import base64
import json

import numpy as np
from agents import (
    Agent,
    AgentUpdatedStreamEvent,
    RawResponsesStreamEvent,
    RunItemStreamEvent,
)
from agents.voice import AudioInput, VoiceStreamEvent, VoiceStreamEventAudio
from fastapi import WebSocket
from openai.types.responses import ResponseTextDeltaEvent

from app.agent_config import get_starting_agent


def transform_data_to_events(audio_np: np.ndarray) -> dict:
    return {
        "type": "response.audio.delta",
        "delta": base64.b64encode(audio_np.tobytes()).decode("utf-8"),
    }


def is_new_output_item(event):
    return isinstance(event, RunItemStreamEvent)


def is_text_output(event):
    return event.type == "raw_response_event" and isinstance(
        event.data, ResponseTextDeltaEvent
    )


def is_sync_message(data):
    return data["type"] == "history.update" and (
        not data["inputs"] or data["inputs"][-1].get("role") != "user"
    )


def is_new_text_message(data):
    return data["type"] == "history.update" and (
        data["inputs"] and data["inputs"][-1].get("role") == "user"
    )


def is_session_init(data):
    return data.get("type") == "session.init"


def process_inputs(data, connection) -> str:
    connection.history = data["inputs"][:-1]
    return data["inputs"][-1]["content"]


def is_new_audio_chunk(data):
    return data["type"] == "input_audio_buffer.append"


def is_audio_complete(data):
    return data["type"] == "input_audio_buffer.commit"


def extract_audio_chunk(data):
    decoded_bytes = base64.b64decode(data["delta"])
    audio_int16 = np.frombuffer(decoded_bytes, dtype=np.int16)
    return audio_int16.astype(np.float32) / 32768.0


def concat_audio_chunks(chunks) -> AudioInput:
    return AudioInput(np.concatenate(chunks))


def _try_parse_complete_assessment(output_str: str):
    try:
        data = json.loads(output_str)
        if data.get("success") and data.get("profile"):
            return data["profile"]
    except (json.JSONDecodeError, TypeError):
        pass
    return None


class WebsocketHelper:
    def __init__(self, websocket: WebSocket, history: list, initial_agent: Agent):
        self.websocket = websocket
        self.history = history or []
        self.latest_agent = initial_agent
        self.partial_response = ""
        self.session_mode = "intake"
        self.session_profile = None
        self.session_lang = "en"

    async def init_session(self, mode: str, profile=None, lang: str = "en"):
        self.session_mode = mode or "intake"
        self.session_profile = profile
        self.session_lang = lang or "en"
        self.latest_agent = get_starting_agent(self.session_mode, self.session_profile, self.session_lang)
        self.history = []
        await self.websocket.send_text(
            json.dumps(
                {
                    "type": "session.ready",
                    "mode": self.session_mode,
                    "agent_name": self.latest_agent.name,
                }
            )
        )

    async def show_user_input(self, user_input: str):
        self.history.append(
            {
                "type": "message",
                "role": "user",
                "content": user_input,
            }
        )
        await self.websocket.send_text(
            json.dumps(
                {
                    "type": "history.updated",
                    "reason": "user.input",
                    "inputs": self.history,
                    "agent_name": self.latest_agent.name,
                }
            )
        )
        return (self.history, self.latest_agent)

    async def stream_response(self, new_tokens: str, is_text: bool = False):
        if is_text:
            return

        self.partial_response += new_tokens
        await self.websocket.send_text(
            json.dumps(
                {
                    "type": "history.updated",
                    "reason": "response.text.delta",
                    "inputs": self.history
                    + [
                        {
                            "type": "message",
                            "role": "assistant",
                            "content": self.partial_response,
                        }
                    ],
                    "agent_name": self.latest_agent.name,
                }
            )
        )

    async def _check_assessment_complete(self, item):
        if item.get("type") != "function_call_output":
            return
        output = item.get("output", "")
        profile = _try_parse_complete_assessment(output)
        if profile:
            await self.websocket.send_text(
                json.dumps({"type": "session.complete", "profile": profile})
            )

    async def handle_new_item(
        self,
        event: RawResponsesStreamEvent | RunItemStreamEvent | AgentUpdatedStreamEvent,
    ):
        if is_new_output_item(event):
            item = event.item.to_input_item()
            self.history.append(item)
            await self._check_assessment_complete(item)
            await self.websocket.send_text(
                json.dumps(
                    {
                        "type": "history.updated",
                        "reason": "response.input_item",
                        "inputs": self.history,
                        "agent_name": self.latest_agent.name,
                    }
                )
            )
        elif is_text_output(event):
            await self.stream_response(event.data.delta)

    async def text_output_complete(self, output, is_done=False):
        if not is_done:
            await self.websocket.send_text(
                json.dumps(
                    {
                        "type": "history.updated",
                        "inputs": self.history,
                        "sync": True,
                        "agent_name": self.latest_agent.name,
                    }
                )
            )
        else:
            self.partial_response = ""
            self.latest_agent = output.last_agent
            self.history = output.to_input_list()
            for item in self.history:
                await self._check_assessment_complete(item)
            await self.websocket.send_text(
                json.dumps(
                    {
                        "type": "history.updated",
                        "inputs": self.history,
                        "reason": "response.done",
                        "agent_name": self.latest_agent.name,
                    }
                )
            )

    async def send_audio_chunk(self, event: VoiceStreamEvent):
        if isinstance(event, VoiceStreamEventAudio):
            await self.websocket.send_text(
                json.dumps(transform_data_to_events(event.data))
            )

    async def send_audio_done(self):
        await self.websocket.send_text(json.dumps({"type": "audio.done"}))

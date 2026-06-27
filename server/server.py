import time
from collections.abc import AsyncIterator
from logging import getLogger

from agents import Runner, trace
from agents.voice import (
    TTSModelSettings,
    VoicePipeline,
    VoicePipelineConfig,
    VoiceWorkflowBase,
)
from app.agent_config import get_starting_agent
from app.utils import (
    WebsocketHelper,
    concat_audio_chunks,
    extract_audio_chunk,
    is_audio_complete,
    is_new_audio_chunk,
    is_new_text_message,
    is_session_init,
    is_sync_message,
    is_text_output,
    process_inputs,
)
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(dotenv_path="../.env", override=True)
load_dotenv(dotenv_path="../.env.local", override=True)

app = FastAPI()
logger = getLogger(__name__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Workflow(VoiceWorkflowBase):
    def __init__(self, connection: WebsocketHelper):
        self.connection = connection

    async def run(self, input_text: str) -> AsyncIterator[str]:
        conversation_history, latest_agent = await self.connection.show_user_input(
            input_text
        )

        output = Runner.run_streamed(
            latest_agent,
            conversation_history,
        )

        async for event in output.stream_events():
            await self.connection.handle_new_item(event)

            if is_text_output(event):
                yield event.data.delta  # type: ignore

        await self.connection.text_output_complete(output, is_done=True)


@app.get("/")
async def health():
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    with trace("MakanWell Voice Chat"):
        await websocket.accept()
        connection = WebsocketHelper(websocket, [], get_starting_agent("intake"))
        audio_buffer = []
        workflow = Workflow(connection)
        session_initialized = False

        while True:
            try:
                message = await websocket.receive_json()
            except WebSocketDisconnect:
                logger.info("Client disconnected")
                return

            if is_session_init(message):
                await connection.init_session(
                    mode=message.get("mode", "intake"),
                    profile=message.get("profile"),
                    lang=message.get("lang", "en"),
                )
                session_initialized = True
                continue

            if not session_initialized:
                await connection.init_session(mode="intake", profile=None, lang="en")
                session_initialized = True

            if is_sync_message(message):
                connection.history = message["inputs"]
                if message.get("reset_agent", False):
                    connection.latest_agent = get_starting_agent(
                        connection.session_mode,
                        connection.session_profile,
                        connection.session_lang,
                    )
            elif is_new_text_message(message):
                user_input = process_inputs(message, connection)
                async for _ in workflow.run(user_input):
                    pass

            elif is_new_audio_chunk(message):
                audio_buffer.append(extract_audio_chunk(message))

            elif is_audio_complete(message):
                start_time = time.perf_counter()

                def transform_data(data):
                    nonlocal start_time
                    if start_time:
                        logger.info(
                            "Time to first byte: %.3fs",
                            time.perf_counter() - start_time,
                        )
                        start_time = None
                    return data

                audio_input = concat_audio_chunks(audio_buffer)
                output = await VoicePipeline(
                    workflow=workflow,
                    config=VoicePipelineConfig(
                        tts_settings=TTSModelSettings(
                            buffer_size=512, transform_data=transform_data
                        )
                    ),
                ).run(audio_input)
                async for event in output.stream():
                    await connection.send_audio_chunk(event)
                await connection.send_audio_done()
                audio_buffer = []


if __name__ == "__main__":
    import os
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))

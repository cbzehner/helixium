"""Trusted keyboard/mouse input into the disposable macOS guest's VNC server."""
import json
import os
import sys
import time
from vncdotool import api

client = api.connect('127.0.0.1', username=os.environ.get('VNC_USER', 'admin'),
                     password=os.environ.get('VNC_PASSWORD', 'admin'), timeout=15)

def key(value):
    # Apple's VNC server can miss down/up events sent in one packet.
    parts = value.split('-') if len(value) > 1 else [value]
    for part in parts:
        client.keyDown(part)
        time.sleep(.12)
    for part in reversed(parts):
        client.keyUp(part)
        time.sleep(.08)

try:
    for line in sys.stdin:
        try:
            command = json.loads(line)
            match command['action']:
                case 'keys':
                    for value in command['keys']:
                        key(value)
                case 'click':
                    client.mouseMove(command['x'], command['y'])
                    client.mouseDown(1)
                    time.sleep(.08)
                    client.mouseUp(1)
                case 'screenshot':
                    client.captureScreen(command['path'])
                case _:
                    raise ValueError('Unknown VNC action')
            print(json.dumps({'ok': True}), flush=True)
        except Exception as error:
            print(json.dumps({'error': str(error)}), flush=True)
finally:
    client.disconnect()
    api.shutdown()

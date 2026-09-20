"""Verify two authenticated HTTP clients against a real saved Sage run; no audio claim."""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get('GINGER_VERIFY_URL', 'http://127.0.0.1:3050')
RUN = sys.argv[1]
values = {}
for line in pathlib.Path(os.environ.get('GINGER_VERIFY_ENV_FILE', '.env.local')).read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
ACCESS = os.environ.get('GINGER_ASH_ROOM_TOKEN') or values.get('GINGER_ASH_ROOM_TOKEN') or os.environ.get('ASH_ACCESS_TOKEN') or values.get('ASH_ACCESS_TOKEN')
assert ACCESS, 'No configured room access token; no credential is printed.'
checks = []

def call(path, body=None, token=None, origin=BASE):
    headers = {'Origin': origin}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)

def check(name, condition):
    assert condition, name
    checks.append(name)

status, _ = call('/api/ash/rooms', {'action': 'catalog', 'accessToken': 'invalid'})
check('Invalid operator credential rejected', status == 401)
status, _ = call('/api/ash/rooms', {'action': 'catalog', 'accessToken': ACCESS}, origin='https://unrelated.invalid')
check('Cross-origin request rejected', status == 403)
status, first = call('/api/ash/rooms', {'action': 'create', 'accessToken': ACCESS, 'name': 'Verification client A', 'roomName': 'Verification · computed forest scenario', 'runId': RUN, 'minute': 120})
check('First authenticated participant creates room', status == 201)
room_id = first['room']['id']
path = '/api/ash/rooms/' + room_id
token_a = first['memberToken']
status, second = call('/api/ash/rooms', {'action': 'join', 'accessToken': ACCESS, 'name': 'Verification client B', 'roomId': room_id})
check('Second authenticated participant joins same room', status == 201)
token_b = second['memberToken']
status, _ = call(path)
check('Anonymous room read rejected', status == 401)
status, forecast = call(path, {'action': 'ask', 'question': 'What is the latest forecast?', 'callId': str(uuid.uuid4())}, token_a)
check('Evidence lookup uses exact selected computed run', status == 200 and forecast['result']['runId'] == RUN and forecast['result']['selected']['runId'] == RUN)
call_id = str(uuid.uuid4())
status, exposure = call(path, {'action': 'ask', 'question': 'What is at risk?', 'callId': call_id}, token_b)
check('Second participant receives computed time-indexed exposure', status == 200 and exposure['result']['runId'] == RUN and exposure['result']['minute'] == 120 and exposure['result']['exposureStatus'] == 'ready')
_, view_a = call(path, token=token_a)
_, view_b = call(path, token=token_b)
check('Both clients see same ordered room events and run', view_a['events'] == view_b['events'] and view_a['runId'] == view_b['runId'] == RUN and len(view_a['members']) == 2)
before = len(view_a['events'])
status, repeated = call(path, {'action': 'ask', 'question': 'What is at risk?', 'callId': call_id}, token_b)
_, after = call(path, token=token_a)
check('Repeated client call is idempotent', repeated == exposure and len(after['events']) == before)
status, _ = call(path, {'action': 'claim-floor'}, token_a)
check('First participant acquires voice floor', status == 200)
status, _ = call(path, {'action': 'claim-floor'}, token_b)
check('Concurrent second voice floor is rejected', status == 409)
status, _ = call(path, {'action': 'tool', 'name': 'asset_exposure', 'args': {}, 'callId': str(uuid.uuid4())}, token_b)
check('Non-floor voice tool execution rejected', status == 409)
status, _ = call(path, {'action': 'release-floor'}, token_a)
check('Voice floor releases cleanly', status == 200)
report = {'roomId': room_id, 'runId': RUN, 'checks': checks, 'forecastOrigin': forecast['result']['forecastOrigin'], 'exposureCounts': exposure['result']['counts'], 'eventsObservedByBothClients': before, 'scope': 'Two HTTP clients, authorization, selected-run tools, shared events and floor arbitration verified. No microphone, Realtime audio or remote audio transport was exercised. No operational action was approved.'}
output = pathlib.Path('artifacts/product-verification')
output.mkdir(parents=True, exist_ok=True)
(output / 'rooms-http-verification.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))

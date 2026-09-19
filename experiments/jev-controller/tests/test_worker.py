import argparse
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import threading
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import pytest
from jev_robot.worker import Worker,handler_for


def test_worker_requires_proxy_header_and_secret_before_starting_any_process(tmp_path):
    args=argparse.Namespace(output=str(tmp_path),sim_smoke=False)
    worker=Worker(args);server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(worker,'private-test-token'))
    t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
    base='http://127.0.0.1:'+str(server.server_port)
    try:
        with pytest.raises(HTTPError) as error:urlopen(Request(base+'/start',data=b''))
        assert error.value.code==403 and worker.process is None
        headers={'X-Jev-Lab':'simulation-proxy','Authorization':'Bearer private-test-token'}
        with urlopen(Request(base+'/status',headers=headers)) as response:
            assert json.load(response)['status']=='ready'
    finally:server.shutdown();server.server_close();t.join()


def test_stopped_worker_never_reports_success_from_a_stale_snapshot(tmp_path):
    worker=Worker(argparse.Namespace(output=str(tmp_path),sim_smoke=False))
    worker.out=tmp_path;worker.stopped=True
    worker.process=type('Process',(),{'poll':lambda self:-15,'returncode':-15})()
    (tmp_path/'live.json').write_text(json.dumps({'success':True,'termination':'running'}))
    state=worker.snapshot()
    assert state['status']=='stopped' and state['result']['success'] is False

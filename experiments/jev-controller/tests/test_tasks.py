import argparse
import json
from pathlib import Path
from unittest.mock import patch
import pytest
from jev_robot.tasks import validate_request, scoring_mode, catalog
from jev_robot.worker import Worker

TASKS=[{"suite":"libero_spatial_swap","task_id":3,"initial_states":2,"instruction":"Put bowl on plate"}]

@pytest.mark.parametrize("settings", [
    {"task_id":False},{"task_id":3,"init_index":2},{"task_id":3,"max_calls":81},
    {"task_id":3,"seed":-1},{"task_id":3,"instruction":"x"*1601},
    {"task_id":3,"command":"ls"},{"task_id":3,"suite":"../secret"},
    {"task_id":3,"instruction":"a\x00b"}])
def test_invalid_browser_settings_are_rejected(settings):
    with pytest.raises(ValueError):validate_request(settings,TASKS)


def test_free_text_is_data_and_custom_goal_never_uses_original_score():
    text='--output=/tmp/not-a-path; $(echo nope)'
    assert validate_request({"task_id":3,"instruction":text},TASKS)['instruction']==text
    assert scoring_mode('', 'Put bowl on plate')=='environment_goal'
    assert scoring_mode(' put bowl on plate ', 'Put bowl on plate')=='environment_goal'
    assert scoring_mode('Lift the other bowl', 'Put bowl on plate')=='custom_unscored'
    assert scoring_mode('', 'Put bowl on plate', True)=='query_only'


def test_worker_forwards_selected_task_and_query_as_arguments_not_shell(tmp_path):
    args=argparse.Namespace(output=str(tmp_path),libero_root='/trusted/libero',assets_root='/trusted/assets',env_file=None,sim_smoke=False)
    worker=Worker(args);worker._tasks=TASKS
    with patch('jev_robot.worker.subprocess.Popen') as spawn:
        spawn.return_value.poll.return_value=0
        status,_=worker.start({'task_id':3,'init_index':1,'seed':9,'instruction':'--test $(cmd)','max_calls':2},query_only=True)
        assert status==202
        argv=spawn.call_args.args[0]
        assert argv[argv.index('--task-id')+1]=='3'
        assert argv[argv.index('--init-index')+1]=='1'
        assert argv[argv.index('--max-calls')+1]=='1'
        assert '--instruction=--test $(cmd)' in argv and '--query-only' in argv
        assert not spawn.call_args.kwargs.get('shell',False)


def test_installed_catalog_ids_match_pinned_declaration_order():
    root=Path(__file__).resolve().parents[1]
    if not (root/'third_party/LIBERO-PRO').exists():pytest.skip('Simulator source not installed')
    tasks=catalog(root/'third_party/LIBERO-PRO',root/'third_party/pro-assets')
    assert len(tasks)>=10 and tasks[0]['task_id']==0
    assert 'between the plate and the ramekin' in tasks[0]['instruction']
    assert all(t['initial_states']>0 for t in tasks)


def test_original_scene_goal_cannot_complete_a_changed_instruction():
    from jev_robot.tasks import observe_goal
    custom={"evaluation_mode":"custom_unscored","success":None,"environment_goal_reached":False,"termination":"step_limit"}
    assert observe_goal(custom,True) is False
    assert custom['success'] is None and custom['environment_goal_reached'] is True
    assert custom['termination']=='step_limit'
    official={**custom,"evaluation_mode":"environment_goal","success":False}
    assert observe_goal(official,True) is True and official['success'] is True

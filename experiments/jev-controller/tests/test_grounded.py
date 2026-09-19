import copy
import numpy as np
import pytest
from jev_robot.grounded import candidates
from jev_robot.cloudflare import JevError
from jev_robot.policy import JevPolicy


def scene():
    return {"source":"simulator_ground_truth", "controller_output_max":[.05,.05,.05,.5,.5,.5],
            "gripper_closing_axis_world":[0,-1,0], "objects":[
        {"name":"bowl", "position_world_m":[0,0,.9], "fixture":False,
         "collision_bounds_world_m":[[-.05,-.05,.9],[.05,.05,.95]], "both_fingers_in_contact":False},
        {"name":"plate", "position_world_m":[.2,0,.9], "fixture":False,
         "collision_bounds_world_m":[[.1,-.1,.89],[.3,.1,.91]], "both_fingers_in_contact":False}]}


def test_rim_grasp_follows_measured_closing_axis_not_assumed_world_x():
    robot=np.array([0,0,1.1,0,0,0,.04,-.04])
    m=candidates(robot,scene(),-1,5)
    assert m["bowl__grasp"]["actions"][0,0] == 0
    assert m["bowl__grasp"]["actions"][0,1] < 0
    assert m["bowl__grasp"]["actions"][0,6] == -1
    assert "bowl__grip" not in m
    for v in m.values():
        assert v["actions"].shape==(5,7)
        assert np.isfinite(v["actions"]).all() and np.abs(v["actions"]).max()<=1


def test_grasp_does_not_teleport_or_automatically_close_and_held_object_is_not_regrasped():
    s=scene();robot=np.array([0,-.0425,.929,0,0,0,.04,-.04])
    m=candidates(robot,s,-1,5)
    np.testing.assert_array_equal(m['bowl__grip']['actions'][0],[0,0,0,0,0,0,1])
    assert not any(o['both_fingers_in_contact'] for o in s['objects'])
    s['objects'][0]['both_fingers_in_contact']=True
    held=candidates(robot,s,1,5)
    assert 'bowl__grip' not in held and 'bowl__grasp' not in held
    assert 'bowl__lift' in held


def test_release_is_offered_only_when_held_object_is_near_destination():
    s=scene();s['objects'][0]['both_fingers_in_contact']=True
    robot=np.array([0,-.04,1.0,0,0,0,.01,-.01])
    assert 'plate__release' not in candidates(robot,s,1,5)
    s['objects'][0]['position_world_m']=[.2,0,.925]
    robot[:3]=[.2,-.04,.955]
    menu=candidates(robot,s,1,5)
    np.testing.assert_array_equal(menu['plate__release']['actions'][0],[0,0,0,0,0,0,-1])


def test_privileged_geometry_and_valid_scale_are_required():
    with pytest.raises(ValueError):JevPolicy(None,'proprio',action_set='grounded')
    s=scene();s['controller_output_max'][0]=0
    with pytest.raises(JevError):candidates(np.zeros(8),s,-1,5)
    s=scene();s['objects'][0]['collision_bounds_world_m'][0][0]=float('nan')
    with pytest.raises(JevError):candidates(np.zeros(8),s,-1,5)


def test_missing_measurements_never_silently_use_invented_geometry():
    robot=np.array([0,0,1.1,0,0,0,.04,-.04])
    for key in ('controller_output_max','gripper_closing_axis_world'):
        s=scene();del s[key]
        with pytest.raises(JevError):candidates(robot,s,-1,5)
    s=scene();del s['objects'][0]['collision_bounds_world_m']
    with pytest.raises(JevError):candidates(robot,s,-1,5)


def test_current_decoder_reproduces_both_recorded_successful_traces():
    import json
    from pathlib import Path
    root=Path(__file__).resolve().parents[3]
    for name in ('improved','web-live'):
        rows=json.loads((root/'public/runs'/name/'trace.json').read_text())
        grip=-1.
        for d in rows:
            menu=candidates(np.asarray(d['state']),d['scene'],grip,5)
            np.testing.assert_allclose(menu[d['jev']['choice']]['actions'],d['actions'],atol=1e-7)
            grip=d['actions'][0][6]

"""Finite, coordinated actions in LIBERO's normalized OSC_POSE space.

These are NOT xArm joint deltas. No inverse kinematics or task planner lives here.
The robosuite controller interprets the selected seven-dimensional command.
"""
from dataclasses import dataclass
from itertools import product

import numpy as np


@dataclass(frozen=True)
class Action:
    name: str
    motion: tuple
    grip: str

    def vector(self, previous_grip):
        g = previous_grip if self.grip == "keep" else {"open": -1.0, "close": 1.0}[self.grip]
        return np.asarray((*self.motion, g), dtype=np.float32)

    def describe(self, horizon):
        translations = ["%s%s" % ("+" if v > 0 else "-", "xyz"[i])
                        for i, v in enumerate(self.motion[:3]) if v]
        rotations = ["%s%s" % ("+" if v > 0 else "-", "xyz"[i])
                     for i, v in enumerate(self.motion[3:]) if v]
        text = "Translate " + ",".join(translations) if translations else "Hold position"
        if rotations:
            text += "; rotate " + ",".join(rotations)
        return text + "; normalized command " + str(list(self.motion)) + "; gripper " + self.grip + "; repeat " + str(horizon) + " steps"


def catalog():
    actions = {}
    def add(name, motion):
        for grip in ("keep", "open", "close"):
            a = Action(name + "_" + grip, tuple(float(v) for v in motion), grip)
            actions[a.name] = a
    add("hold", [0] * 6)
    for label, magnitude in (("fine", 0.08), ("coarse", 0.25)):
        for direction in product((-1, 0, 1), repeat=3):
            if not any(direction):
                continue
            suffix = "".join({-1: "m", 0: "0", 1: "p"}[v] for v in direction)
            add("translate_" + label + "_" + suffix, [magnitude * v for v in direction] + [0] * 3)
        for axis in range(3):
            for sign in (-1, 1):
                vec = [0.0] * 6
                vec[axis + 3] = magnitude * sign
                add("rotate_" + label + "_" + "xyz"[axis] + ("m" if sign < 0 else "p"), vec)
    assert len(actions) == 195
    return actions


ACTIONS = catalog()


def decode(name, horizon, previous_grip):
    if name not in ACTIONS:
        raise ValueError("Jev selected an unknown action")
    if not isinstance(horizon, int) or not 1 <= horizon <= 5:
        raise ValueError("Action horizon must be 1..5")
    if previous_grip not in (-1.0, 1.0):
        raise ValueError("Invalid remembered gripper command")
    vector = ACTIONS[name].vector(previous_grip)
    return np.repeat(vector[None, :], horizon, axis=0)

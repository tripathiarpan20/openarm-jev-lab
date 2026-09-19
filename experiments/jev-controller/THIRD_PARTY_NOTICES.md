# Third-party references

`jev_robot/wire.py` implements the NumPy/msgpack representation documented by
Physical Intelligence's OpenPI client (`msgpack_numpy.py`), pinned at
`15a9616a00943ada6c20a0f158e3adb39df2ccac`. The upstream client is Apache-2.0:
https://github.com/Physical-Intelligence/openpi/blob/15a9616a00943ada6c20a0f158e3adb39df2ccac/LICENSE

The pinned OpenPI and LIBERO-Pro checkouts retain their own licenses in
`third_party/`. They are downloaded during setup and excluded from Git.

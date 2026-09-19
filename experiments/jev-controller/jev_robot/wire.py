"""OpenPI-compatible msgpack array encoding, without pickle or object dtypes."""
import msgpack
import numpy as np


def encode(obj):
    if isinstance(obj, (np.ndarray, np.generic)) and obj.dtype.kind in "VOc":
        raise ValueError("Unsupported array dtype")
    if isinstance(obj, np.ndarray):
        return {b"__ndarray__": True, b"data": obj.tobytes(), b"dtype": obj.dtype.str, b"shape": obj.shape}
    if isinstance(obj, np.generic):
        return {b"__npgeneric__": True, b"data": obj.item(), b"dtype": obj.dtype.str}
    raise TypeError("Unsupported wire value")


def decode(obj):
    if b"__ndarray__" in obj:
        dtype = np.dtype(obj[b"dtype"])
        if dtype.kind not in "biuf":
            raise ValueError("Unsupported array dtype")
        return np.ndarray(buffer=obj[b"data"], dtype=dtype, shape=obj[b"shape"])
    if b"__npgeneric__" in obj:
        dtype = np.dtype(obj[b"dtype"])
        if dtype.kind not in "biuf":
            raise ValueError("Unsupported scalar dtype")
        return dtype.type(obj[b"data"])
    return obj


def pack(value):
    return msgpack.packb(value, default=encode)


def unpack(value):
    return msgpack.unpackb(value, object_hook=decode)

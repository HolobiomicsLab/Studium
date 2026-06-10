import sys, os
_dir = os.path.dirname(__file__)
for _p in (_dir, os.path.join(_dir, "../../packages/perspicacite-client/python")):
    _p = os.path.abspath(_p)
    if _p not in sys.path:
        sys.path.insert(0, _p)

#!/usr/bin/env python3
"""Rebuild models-inline.js (base64 fallback) from models/*.glb:  python3 tools/make_inline.py"""
import base64, os
r = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
b = lambda f: base64.b64encode(open(os.path.join(r, 'models', f), 'rb').read()).decode()
open(os.path.join(r, 'models-inline.js'), 'w').write('/* Bundled fallback for the supplied Care Anatomy GLB models (basic_human_female.glb, basic_male_model.glb). Byte-for-byte copies of the files in models/. */\nglobalThis.CARE_ANATOMY_EMBEDDED_GLB = {\n  female: "%s",\n  male: "%s"\n};\n' % (b('basic_human_female.glb'), b('basic_male_model.glb')))

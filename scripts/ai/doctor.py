#!/usr/bin/env python3
"""Read-only local prerequisites; never prints key values or loads .env."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[2]


def config_summary(path):
    if not path.is_file():
        return {'exists': False}
    try:
        data = tomllib.loads(path.read_text(encoding='utf-8'))
        agents = data.get('agents', {})
        return {'exists': True, 'valid_toml': True,
                'agents_enabled': agents.get('enabled', 'default'),
                'max_concurrent_threads_per_session': agents.get('max_concurrent_threads_per_session'),
                'legacy_multi_agent': data.get('features', {}).get('multi_agent')}
    except (OSError, ValueError):
        return {'exists': True, 'valid_toml': False}


def main():
    git = subprocess.run(['git', 'status', '--short'], cwd=ROOT,
                         capture_output=True, text=True, check=False)
    roles = {}
    for name in ('worker', 'explorer'):
        path = ROOT / '.codex/agents' / f'{name}.toml'
        roles[name] = config_summary(path)
    result = {
        'git': {'exit_code': git.returncode, 'changes': git.stdout.splitlines()},
        'agents_md_exists': (ROOT / 'AGENTS.md').is_file(),
        'codex_cli_available': shutil.which('codex') is not None,
        'gemini_api_available': shutil.which('gemini-api') is not None,
        'gemini_api_key_available': bool(os.environ.get('GEMINI_API_KEY', '').strip()),
        'project_config': config_summary(ROOT / '.codex/config.toml'),
        'user_config': config_summary(Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'config.toml'),
        'roles': roles,
        'native_subagents': 'Verify actual spawn tools in the active Codex session; CLI presence does not prove availability.',
    }
    print(json.dumps(result, indent=2))
    return 0 if result['gemini_api_available'] and result['gemini_api_key_available'] and git.returncode == 0 else 4


if __name__ == '__main__':
    sys.exit(main())

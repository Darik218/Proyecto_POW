#!/usr/bin/env python3
"""Install additive project configuration, refusing to overwrite existing files."""
import argparse
import json
from pathlib import Path
import sys
import tomllib

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def install(root=ROOT, check=False):
    sources = {
        root / '.codex/config.toml': HERE / 'codex/config.toml',
        root / '.codex/agents/worker.toml': HERE / 'codex/worker.toml',
        root / '.codex/agents/explorer.toml': HERE / 'codex/explorer.toml',
    }
    pending = []
    # Preflight every destination before writing anything. Never merge by guessing.
    for destination, source in sources.items():
        tomllib.loads(source.read_text(encoding='utf-8'))
        if any(p.is_symlink() for p in [destination, *destination.parents]):
            raise ValueError('Refusing a symlinked configuration destination.')
        if any(p.exists() and not p.is_dir() for p in destination.parents):
            raise ValueError('Configuration parent exists and is not a directory; unchanged.')
        if destination.exists():
            if destination.read_bytes() != source.read_bytes():
                raise ValueError(f'Existing configuration differs: {destination.relative_to(root)}; unchanged.')
        else:
            pending.append((destination, source))
    if not check:
        for destination, source in pending:
            destination.parent.mkdir(parents=True, exist_ok=True)
            # Exclusive creation also protects against changes after preflight.
            with destination.open('xb') as target:
                target.write(source.read_bytes())
    return {'mode': 'check' if check else 'install',
            'files': [str(p.relative_to(root)) for p in sources],
            'pending' if check else 'created': [str(p.relative_to(root)) for p, _ in pending]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Preview without writing.')
    args = parser.parse_args()
    try:
        print(json.dumps(install(check=args.check), indent=2))
        return 0
    except (OSError, ValueError) as error:
        print(json.dumps({'error': str(error), 'exit_code': 9}), file=sys.stderr)
        return 9


if __name__ == '__main__':
    sys.exit(main())

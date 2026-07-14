#!/usr/bin/env python3
"""
compile_modes.py — Compila y valida todos los templates de modos.
Genera un artefacto JSON compilado para cada template.
"""
import json
import sys
import os
from pathlib import Path

# Opcodes sincronizados desde scratch-blocks.js (scripts/sync_opcodes.js).
# Fuente única de verdad: no editar a mano, ejecutar el sync.
try:
    from opcodes_gen import VALID_SCRATCH_OPCODES
except ImportError:
    # Fallback si no se ha generado todavía.
    VALID_SCRATCH_OPCODES = set()

TEMPLATES_DIR = Path(__file__).parent.parent / "interno" / "modo_templates"
COMPILED_DIR = TEMPLATES_DIR / "compiled"


def validate_block_chain(chain, path, errors):
    """Valida recursivamente una cadena de bloques."""
    if not isinstance(chain, list):
        return
    for block in chain:
        if not isinstance(block, dict):
            errors.append(f"{path}: block must be dict, got {type(block).__name__}")
            continue
        opcode = block.get('opcode')
        if not opcode:
            errors.append(f"{path}: block missing 'opcode'")
            continue
        if opcode not in VALID_SCRATCH_OPCODES:
            errors.append(f"{path}: unknown opcode '{opcode}'")
        args = block.get('args', {})
        if not isinstance(args, dict):
            errors.append(f"{path}: args for '{opcode}' must be dict")
        # Validate nested chains (next, body, elseBody)
        for key in ('next', 'body', 'elseBody', 'fallback'):
            if key in block and block[key] is not None:
                validate_block_chain(block[key], f"{path}.{opcode}.{key}", errors)


def compile_scratch_template(tpl):
    """Compila un template scratch a formato normalizado."""
    return {
        "version": "2.0",
        "compiled": True,
        "id": tpl.get("id"),
        "title": tpl.get("title"),
        "description": tpl.get("description"),
        "tags": tpl.get("tags", []),
        "difficulty": tpl.get("difficulty", "media"),
        "event_count": len(tpl.get("heads", {})),
        "events": list(tpl.get("heads", {}).keys()),
        "heads": tpl.get("heads", {})
    }


def compile_base_template(tpl):
    """Compila un template base a formato normalizado."""
    return {
        "version": "2.0",
        "compiled": True,
        "id": tpl.get("id"),
        "nombre": tpl.get("nombre"),
        "descripcion": tpl.get("descripcion"),
        "categoria": tpl.get("categoria"),
        "template_config": tpl.get("template_config", {}),
        "componentes": tpl.get("componentes", []),
        "atributos": tpl.get("atributos", {})
    }


def main():
    errors = []
    compiled = []

    # Validate and compile scratch templates
    scratch_dir = TEMPLATES_DIR / "scratch"
    if scratch_dir.exists():
        for f in sorted(scratch_dir.glob("*.json")):
            try:
                with open(f, 'r', encoding='utf-8') as fh:
                    data = json.load(fh)
                # Validate heads
                heads = data.get("heads", {})
                for event_name, chains in heads.items():
                    if not event_name.startswith("on_"):
                        errors.append(f"{f.name}: event '{event_name}' should start with 'on_'")
                    validate_block_chain(chains, f"{f.name}.{event_name}", errors)
                # Compile
                compiled.append(compile_scratch_template(data))
                print(f"  OK {f.name}")
            except json.JSONDecodeError as e:
                errors.append(f"{f.name}: invalid JSON: {e}")
                print(f"  FAIL {f.name}: {e}")

    # Validate and compile base templates
    base_dir = TEMPLATES_DIR / "base"
    if base_dir.exists():
        for f in sorted(base_dir.glob("*.json")):
            try:
                with open(f, 'r', encoding='utf-8') as fh:
                    data = json.load(fh)
                compiled.append(compile_base_template(data))
                print(f"  OK {f.name}")
            except json.JSONDecodeError as e:
                errors.append(f"{f.name}: invalid JSON: {e}")
                print(f"  FAIL {f.name}: {e}")

    # Write compiled output
    COMPILED_DIR.mkdir(parents=True, exist_ok=True)
    output = {
        "version": "2.0",
        "template_count": len(compiled),
        "templates": compiled
    }
    output_path = COMPILED_DIR / "all_modes.json"
    with open(output_path, 'w', encoding='utf-8') as fh:
        json.dump(output, fh, ensure_ascii=False, indent=2)
    print(f"\nCompiled {len(compiled)} templates -> {output_path}")

    if errors:
        print(f"\n{len(errors)} errors found:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)

    print("\nAll templates valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Bundle all Contractor OS source files into one copy-paste document."""
import os

FILES = [
    # Backend
    "backend/server.py",
    "backend/estimator.py",
    "backend/seed_data.py",
    "backend/requirements.txt",
    "backend/.env",
    # Frontend config
    "frontend/package.json",
    "frontend/app.json",
    # Frontend shared
    "frontend/src/theme.ts",
    "frontend/src/api/client.ts",
    "frontend/src/context/AuthContext.tsx",
    "frontend/src/components/ui.tsx",
    "frontend/src/components/Estimator.tsx",
    # Frontend routes
    "frontend/app/_layout.tsx",
    "frontend/app/index.tsx",
    "frontend/app/login.tsx",
    "frontend/app/(tabs)/_layout.tsx",
    "frontend/app/(tabs)/index.tsx",
    "frontend/app/(tabs)/crm.tsx",
    "frontend/app/(tabs)/quotes.tsx",
    "frontend/app/(tabs)/jobs.tsx",
]

ROOT = "/app"
OUT = "/app/contractor_os_full_source.md"

LANG = {".py": "python", ".ts": "typescript", ".tsx": "tsx",
        ".json": "json", ".env": "bash", ".txt": "text"}


def lang_for(path):
    if path.endswith(".env"):
        return "bash"
    _, ext = os.path.splitext(path)
    return LANG.get(ext, "text")


def main():
    parts = []
    parts.append("# CONTRACTOR OS — Full Source Code\n")
    parts.append("Stack: FastAPI + MongoDB (backend) · Expo React Native / expo-router (frontend)\n")
    parts.append("\n## File Index\n")
    for f in FILES:
        parts.append(f"- `{f}`\n")
    parts.append("\n---\n")

    for f in FILES:
        full = os.path.join(ROOT, f)
        if not os.path.exists(full):
            continue
        with open(full, "r") as fh:
            content = fh.read()
        # Redact secret values in .env
        if f.endswith(".env"):
            lines = []
            for ln in content.splitlines():
                if ln.startswith("JWT_SECRET"):
                    ln = 'JWT_SECRET="<your-secret-here>"'
                lines.append(ln)
            content = "\n".join(lines)
        parts.append(f"\n\n## `{f}`\n\n```{lang_for(f)}\n{content}\n```\n")

    with open(OUT, "w") as out:
        out.write("".join(parts))

    size = os.path.getsize(OUT)
    lines = sum(1 for _ in open(OUT))
    print(f"Wrote {OUT} ({size:,} bytes, {lines:,} lines) from {len(FILES)} files")


if __name__ == "__main__":
    main()

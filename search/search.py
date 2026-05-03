#!/usr/bin/env python3
"""
Semantic search over the ClaudeGPT knowledge base.

Usage:
    # Build/rebuild the index
    python search.py --build

    # Search
    python search.py "feeling isolated and watching others live"
    python search.py "business stress and quitting" --top 10

    # Both (rebuild then search)
    python search.py --build "ambition vs connection"
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).parent.parent
KB_ROOT = REPO_ROOT / "user"
INDEX_PATH = REPO_ROOT / ".search-index.json"
MODEL_NAME = "all-MiniLM-L6-v2"


def get_model():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(MODEL_NAME)


def collect_documents():
    """Collect all markdown files from the KB, chunked by file with metadata."""
    if not KB_ROOT.exists():
        print("No user/ directory found. Start a conversation first — Claude will create it.")
        return []
    docs = []
    for md_file in sorted(KB_ROOT.rglob("*.md")):
        rel_path = str(md_file.relative_to(KB_ROOT))
        # Skip READMEs and index files
        if md_file.name in ("README.md", "index.md"):
            continue
        try:
            content = md_file.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if not content.strip():
            continue

        # Extract title from first heading
        title = rel_path
        for line in content.split("\n"):
            if line.startswith("# "):
                title = line[2:].strip()
                break

        # Extract front matter tags if present
        tags = ""
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                for fm_line in parts[1].split("\n"):
                    if fm_line.strip().startswith("tags:"):
                        tags = fm_line.strip()

        # Create a searchable text blob: title + tags + content (truncated)
        # Limit to ~1500 chars to keep embeddings meaningful
        search_text = f"{title}\n{tags}\n{content[:1500]}"

        docs.append({
            "path": rel_path,
            "title": title,
            "text": search_text,
            "preview": content[:300].replace("\n", " ").strip()
        })

    return docs


def build_index():
    """Build the embedding index."""
    print(f"Collecting documents from {KB_ROOT}...")
    docs = collect_documents()
    print(f"Found {len(docs)} documents.")

    if not docs:
        return

    print(f"Loading model '{MODEL_NAME}'...")
    model = get_model()

    print("Generating embeddings...")
    texts = [d["text"] for d in docs]
    embeddings = model.encode(texts, show_progress_bar=True, normalize_embeddings=True)

    # Store index
    index_data = {
        "model": MODEL_NAME,
        "documents": [
            {"path": d["path"], "title": d["title"], "preview": d["preview"]}
            for d in docs
        ],
        "embeddings": embeddings.tolist()
    }

    INDEX_PATH.write_text(json.dumps(index_data), encoding="utf-8")
    print(f"Index saved to {INDEX_PATH} ({len(docs)} documents)")


def search(query: str, top_k: int = 5):
    """Search the index with a natural language query."""
    if not INDEX_PATH.exists():
        print("No index found. Building it now...")
        build_index()
        if not INDEX_PATH.exists():
            print("No documents to search yet.")
            return

    index_data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    embeddings = np.array(index_data["embeddings"])
    documents = index_data["documents"]

    model = get_model()
    query_embedding = model.encode([query], normalize_embeddings=True)

    # Cosine similarity (embeddings are normalized, so dot product = cosine sim)
    similarities = (embeddings @ query_embedding.T).flatten()
    top_indices = similarities.argsort()[::-1][:top_k]

    print(f"\n{'='*60}")
    print(f"  Query: \"{query}\"")
    print(f"{'='*60}\n")

    for rank, idx in enumerate(top_indices, 1):
        doc = documents[idx]
        score = similarities[idx]
        print(f"  {rank}. [{score:.3f}] {doc['title']}")
        print(f"     user/{doc['path']}")
        print(f"     {doc['preview'][:120]}...")
        print()


def main():
    parser = argparse.ArgumentParser(description="Semantic search over the KB")
    parser.add_argument("query", nargs="?", help="Search query")
    parser.add_argument("--build", action="store_true", help="Build/rebuild the index")
    parser.add_argument("--top", type=int, default=5, help="Number of results (default 5)")

    args = parser.parse_args()

    if args.build:
        build_index()

    if args.query:
        search(args.query, args.top)
    elif not args.build:
        parser.print_help()


if __name__ == "__main__":
    main()

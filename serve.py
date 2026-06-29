#!/usr/bin/env python3
"""Minimal static server with a fixed absolute directory.
Avoids os.getcwd() (which fails in some restricted environments) and
disables caching so edits are always reflected on reload."""
import http.server
import socketserver
import os

ROOT = "/Users/santiagoszuchmacher/Downloads/REPOS/Santi Repos/grafo-filosofos"
PORT = 8123


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # Tell browsers never to cache, so changes show up immediately in dev.
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Sirviendo {ROOT} en http://localhost:{PORT}")
        httpd.serve_forever()

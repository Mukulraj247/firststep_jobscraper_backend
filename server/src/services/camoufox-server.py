"""
Camoufox Playwright Server for Maxun
Runs Camoufox as a remote Playwright-compatible WebSocket server.
Exposes:
  - WS endpoint on port CAMOUFOX_WS_PORT (default 3003)
  - Health check on port CAMOUFOX_HEALTH_PORT (default 3004)

Anti-detection features enabled:
  - Virtual display (Xvfb) instead of true headless mode
  - Human-like cursor movement (humanize)
  - Cross-Origin-Opener-Policy disabled (for Turnstile checkboxes)
  - Full BrowserForge fingerprint generation
"""

import os
import sys
import json
import signal
import threading
import subprocess
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# Configuration from environment
WS_PORT = int(os.environ.get("CAMOUFOX_WS_PORT", "3003"))
HEALTH_PORT = int(os.environ.get("CAMOUFOX_HEALTH_PORT", "3004"))

# Global state
ws_endpoint = None
camoufox_process = None
xvfb_process = None
server_healthy = False


class HealthHandler(BaseHTTPRequestHandler):
    """Health check HTTP handler."""

    def do_GET(self):
        if self.path == "/health":
            if server_healthy and ws_endpoint:
                response = {
                    "status": "healthy",
                    "wsEndpoint": ws_endpoint,
                    "browserType": "camoufox",
                }
                self.send_response(200)
            else:
                response = {
                    "status": "unhealthy",
                    "wsEndpoint": None,
                    "browserType": "camoufox",
                }
                self.send_response(503)

            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        """Suppress default logging for health checks."""
        pass


def start_health_server():
    """Start the health check HTTP server in a background thread."""
    server = HTTPServer(("0.0.0.0", HEALTH_PORT), HealthHandler)
    print(f"[Camoufox] Health server listening on port {HEALTH_PORT}")
    server.serve_forever()


def start_xvfb(display=":99"):
    """Start Xvfb virtual display for non-headless browser in Docker."""
    global xvfb_process

    # Remove stale lock file if it exists
    lock_file = f"/tmp/.X{display.strip(':')}-lock"
    if os.path.exists(lock_file):
        try:
            os.remove(lock_file)
        except Exception:
            pass

    try:
        xvfb_process = subprocess.Popen(
            [
                "Xvfb", display,
                "-screen", "0", "3840x2160x24",
                "-ac",
                "-nolisten", "tcp",
                "+extension", "GLX",
            ],
            stdout=sys.stdout,
            stderr=sys.stderr,
        )
        time.sleep(1)  # Give Xvfb a moment to start
        if xvfb_process.poll() is not None:
             raise Exception(f"Xvfb exited immediately with code {xvfb_process.poll()}")
        os.environ["DISPLAY"] = display
        print(f"[Camoufox] Xvfb virtual display started on {display}")
        return True
    except Exception as e:
        print(f"[Camoufox] WARNING: Failed to start Xvfb: {e}")
        print("[Camoufox] Falling back to headless mode")
        if "DISPLAY" in os.environ:
             del os.environ["DISPLAY"]
        return False


def launch_camoufox():
    """Launch Camoufox with anti-detection features enabled."""
    global ws_endpoint, server_healthy, camoufox_process

    print(f"[Camoufox] Starting Camoufox server on port {WS_PORT}...")

    try:
        from camoufox.utils import launch_options
        from camoufox.server import get_nodejs, to_camel_case_dict, LAUNCH_SCRIPT
        from pathlib import Path
        import base64
        import orjson

        # Determine if we have a virtual display running
        has_display = "DISPLAY" in os.environ

        # Build proxy config from environment variables
        proxy_server = os.environ.get("CAMOUFOX_PROXY_SERVER", "").strip()
        scraper_proxy_raw = os.environ.get("SCRAPER_PROXY_ENABLED", "true").strip().lower()
        scraper_proxy_enabled = scraper_proxy_raw not in ("false", "0", "no", "off")
        if not scraper_proxy_enabled:
            proxy_server = ""
            print("[Camoufox] SCRAPER_PROXY_ENABLED=false — launching without CAMOUFOX_PROXY_SERVER")

        proxy_config = None
        if proxy_server:
            proxy_config = {"server": proxy_server}
            proxy_user = os.environ.get("CAMOUFOX_PROXY_USERNAME", "").strip()
            proxy_pass = os.environ.get("CAMOUFOX_PROXY_PASSWORD", "").strip()
            if proxy_user:
                proxy_config["username"] = proxy_user
            if proxy_pass:
                proxy_config["password"] = proxy_pass

        # Get the configuration with anti-detection features
        launch_kwargs = dict(
            headless=not has_display,      # Use real rendering if Xvfb is available
            humanize=True,                 # Human-like cursor movement
            disable_coop=True,             # Allow clicking Turnstile checkboxes
            i_know_what_im_doing=True,     # Suppress leak warnings for disable_coop
            virtual_display=os.environ.get("DISPLAY") if has_display else None,
        )

        if proxy_config:
            launch_kwargs["proxy"] = proxy_config
            launch_kwargs["geoip"] = True  # Auto-match geolocation to proxy IP
            print(f"[Camoufox] Proxy configured: {proxy_server}")

        config = launch_options(**launch_kwargs)

        # Remove the bugged 'proxy': None
        if "proxy" in config and config["proxy"] is None:
            del config["proxy"]

        print(f"[Camoufox] Launch config: headless={not has_display}, humanize=True, disable_coop=True, proxy={'yes' if proxy_config else 'none'}, display={os.environ.get('DISPLAY', 'none')}")

        data = orjson.dumps(to_camel_case_dict(config))
        nodejs = get_nodejs()

        camoufox_process = subprocess.Popen(
            [nodejs, str(LAUNCH_SCRIPT)],
            cwd=Path(nodejs).parent / "package",
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        # Write data to stdin and close the stream
        if camoufox_process.stdin:
            camoufox_process.stdin.write(base64.b64encode(data).decode())
            camoufox_process.stdin.close()

        # Read output line by line to find the WebSocket endpoint
        for line in iter(camoufox_process.stdout.readline, ""):
            line = line.strip()
            if line:
                print(f"[Camoufox] {line}")

            if "ws://" in line or "wss://" in line:
                parts = line.split()
                for part in parts:
                    part = part.strip().replace("\x1b[93m", "").replace("\x1b[0m", "")
                    if part.startswith("ws://") or part.startswith("wss://"):
                        ws_endpoint = part

                        # Extract internal port
                        from urllib.parse import urlparse
                        parsed = urlparse(ws_endpoint)
                        internal_host = "127.0.0.1"
                        internal_port = parsed.port

                        server_healthy = True
                        print(f"[Camoufox] WebSocket endpoint ready internally: {ws_endpoint}")

                        # Start TCP Proxy using socat
                        subprocess.Popen(
                            ["socat", f"TCP-LISTEN:{WS_PORT},fork,reuseaddr", f"TCP:{internal_host}:{internal_port}"],
                        )
                        print(f"[Camoufox] Proxying 0.0.0.0:{WS_PORT} -> {internal_host}:{internal_port} using socat")

                        # Overwrite ws_endpoint so healthchecker gives the proxied endpoint
                        ws_endpoint = f"ws://localhost:{WS_PORT}{parsed.path}"
                        break

        # If we get here, the process ended
        exit_code = camoufox_process.wait()
        server_healthy = False
        print(f"[Camoufox] Process exited with code {exit_code}")

    except Exception as e:
        print(f"[Camoufox] ERROR: {e}")
        import traceback
        traceback.print_exc()
        server_healthy = False


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully."""
    global camoufox_process, xvfb_process, server_healthy
    print(f"\n[Camoufox] Received signal {signum}, shutting down...")
    server_healthy = False
    if camoufox_process:
        camoufox_process.terminate()
        try:
            camoufox_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            camoufox_process.kill()
    if xvfb_process:
        xvfb_process.terminate()
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Start health check server in background thread
    health_thread = threading.Thread(target=start_health_server, daemon=True)
    health_thread.start()

    # Start virtual display (Xvfb) for non-headless rendering
    start_xvfb(":99")

    # Launch Camoufox (blocks until process exits, restarts on failure)
    while True:
        launch_camoufox()
        print("[Camoufox] Restarting in 5 seconds...")
        time.sleep(5)

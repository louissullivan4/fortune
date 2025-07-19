import os
import sys
import subprocess
import time
import webbrowser
from pathlib import Path
import threading


def start_backend():
    print("🚀 Starting FastAPI backend server...")
    try:
        backend_process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "src.main:app",
                "--host",
                "0.0.0.0",
                "--port",
                "8000",
                "--reload",
            ],
            cwd=os.getcwd(),
        )

        print("✅ Backend server started on http://localhost:8000")
        return backend_process
    except Exception as e:
        print(f"❌ Failed to start backend server: {e}")
        return None


def start_frontend():
    print("🌐 Starting frontend server...")
    try:
        frontend_dir = Path("frontend")
        if not frontend_dir.exists():
            print("❌ Frontend directory not found!")
            return None

        frontend_process = subprocess.Popen(
            [sys.executable, "-m", "http.server", "3000"], cwd=frontend_dir
        )

        print("✅ Frontend server started on http://localhost:3000")
        return frontend_process
    except Exception as e:
        print(f"❌ Failed to start frontend server: {e}")
        return None


def open_browser():
    time.sleep(3)
    try:
        webbrowser.open("http://localhost:3000")
        print("🌍 Opening dashboard in your default browser...")
    except Exception as e:
        print(f"⚠️  Could not open browser automatically: {e}")
        print("   Please manually open: http://localhost:3000")


def main():
    print("📈 Fortune Trading Dashboard")
    print("=" * 40)

    if not Path("src/main.py").exists():
        print("❌ Backend not found! Make sure you're in the project root directory.")
        return

    if not Path("frontend/index.html").exists():
        print("❌ Frontend not found! Make sure the frontend directory exists.")
        return

    backend_process = start_backend()
    if not backend_process:
        return

    frontend_process = start_frontend()
    if not frontend_process:
        backend_process.terminate()
        return

    browser_thread = threading.Thread(target=open_browser)
    browser_thread.daemon = True
    browser_thread.start()

    print("\n🎉 Dashboard is starting up!")
    print("📊 Backend API: http://localhost:8000")
    print("🌐 Frontend: http://localhost:3000")
    print("📖 API Docs: http://localhost:8000/docs")
    print("\nPress Ctrl+C to stop all servers...")

    try:
        while True:
            time.sleep(1)

            if backend_process.poll() is not None:
                print("❌ Backend server stopped unexpectedly")
                break
            if frontend_process.poll() is not None:
                print("❌ Frontend server stopped unexpectedly")
                break

    except KeyboardInterrupt:
        print("\n🛑 Shutting down servers...")

        if backend_process:
            backend_process.terminate()
            backend_process.wait()
        if frontend_process:
            frontend_process.terminate()
            frontend_process.wait()

        print("✅ All servers stopped")


if __name__ == "__main__":
    main()

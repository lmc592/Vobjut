import os, requests, pytest, uuid

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://contractor-platform-5.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

@pytest.fixture(scope="session")
def api():
    return API

@pytest.fixture(scope="session")
def s():
    return requests.Session()

def _register(s, api, prefix="A"):
    email = f"test_{prefix}_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{api}/auth/register", json={
        "company_name": f"TEST_Co_{prefix}", "name": f"Owner {prefix}",
        "email": email, "password": "pass1234"
    })
    assert r.status_code == 200, r.text
    return r.json(), email

@pytest.fixture(scope="session")
def owner_a(s, api):
    data, email = _register(s, api, "A")
    return {"token": data["token"], "user": data["user"], "company": data["company"], "email": email, "password": "pass1234"}

@pytest.fixture(scope="session")
def owner_b(s, api):
    data, email = _register(s, api, "B")
    return {"token": data["token"], "user": data["user"], "company": data["company"], "email": email, "password": "pass1234"}

def auth(tok): return {"Authorization": f"Bearer {tok}"}

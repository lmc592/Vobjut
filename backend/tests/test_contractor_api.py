import requests, uuid
from conftest import auth

# ---- Auth & Me ----
def test_login_existing_seed(s, api):
    r = s.post(f"{api}/auth/login", json={"email":"jane@acme.com.au","password":"pass123"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "OWNER"

def test_auth_me(s, api, owner_a):
    r = s.get(f"{api}/auth/me", headers=auth(owner_a["token"]))
    assert r.status_code == 200
    assert r.json()["user"]["email"] == owner_a["email"]

def test_password_reset_flow(s, api, owner_a):
    r = s.post(f"{api}/auth/password-reset/request", json={"email": owner_a["email"]})
    assert r.status_code == 200
    tok = r.json().get("reset_token")
    assert tok
    r2 = s.post(f"{api}/auth/password-reset/confirm", json={"token": tok, "new_password": "newpass456"})
    assert r2.status_code == 200
    # login with new password
    r3 = s.post(f"{api}/auth/login", json={"email": owner_a["email"], "password":"newpass456"})
    assert r3.status_code == 200
    # restore
    tok2 = s.post(f"{api}/auth/password-reset/request", json={"email": owner_a["email"]}).json()["reset_token"]
    s.post(f"{api}/auth/password-reset/confirm", json={"token": tok2, "new_password": owner_a["password"]})

# ---- Calculation engine ----
def test_calculate_quote_formula(s, api, owner_a):
    payload = {"materials": 6000, "labour": 3500, "overhead_percentage":10, "profit_percentage":15, "gst_rate":10}
    r = s.post(f"{api}/calculate-quote", json=payload, headers=auth(owner_a["token"]))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["direct_cost"] == 9500
    assert d["overheads"] == 950.0
    # subtotal 10450, profit 15% = 1567.5, pre_gst 12017.5, gst 1201.75, final 13219.25
    assert d["profit"] == 1567.5
    assert d["pre_gst"] == 12017.5
    assert d["gst"] == 1201.75
    assert d["final_total"] == 13219.25

# ---- Contingency in calculation ----
def test_calculate_quote_with_contingency(s, api, owner_a):
    # direct 6000 @10% contingency => contingency 600, subtotal 6600
    # overheads 10% of 6600 = 660, subtotal 7260, profit 15% = 1089, pre_gst 8349
    # gst 10% = 834.9, final = 9183.9
    payload = {"materials": 6000, "labour": 0, "overhead_percentage":10, "profit_percentage":15, "gst_rate":10, "contingency_percentage":10}
    r = s.post(f"{api}/calculate-quote", json=payload, headers=auth(owner_a["token"]))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["direct_cost"] == 6000
    assert d["contingency"] == 600.0
    assert d["overheads"] == 660.0
    assert d["profit"] == 1089.0
    assert d["gst"] == 834.9
    assert d["final_total"] == 9183.9

def test_quote_create_with_contingency_and_status_any_direction(s, api, owner_a):
    h = auth(owner_a["token"])
    cust = s.post(f"{api}/customers", json={"name":"TEST_ContingCust"}, headers=h).json()
    q_payload = {
        "title":"TEST_Contingency_Quote","customer_id":cust["id"],
        "items":[{"description":"Slab","kind":"material","quantity":50,"unit":"m2","unit_rate":120}],
        "overhead_percentage":10,"profit_percentage":15,"contingency_percentage":10
    }
    r = s.post(f"{api}/quotes", json=q_payload, headers=h)
    assert r.status_code == 200, r.text
    q = r.json()
    qid = q["id"]
    assert q["breakdown"]["direct_cost"] == 6000
    assert q["breakdown"]["contingency"] == 600.0
    assert q["breakdown"]["overheads"] == 660.0
    assert q["breakdown"]["profit"] == 1089.0
    assert q["breakdown"]["gst"] == 834.9
    assert q["breakdown"]["final_total"] == 9183.9
    # Now test ANY-direction status transitions
    for st in ["SENT","ACCEPTED","DRAFT","REJECTED","EXPIRED","ACCEPTED"]:
        rs = s.patch(f"{api}/quotes/{qid}/status", json={"status":st}, headers=h)
        assert rs.status_code == 200, f"failed to set {st}: {rs.text}"
        # verify persisted
        rg = s.get(f"{api}/quotes/{qid}", headers=h)
        assert rg.status_code == 200
        assert rg.json()["status"] == st, f"expected {st}, got {rg.json()['status']}"

# ---- Pricing rates ----
def test_pricing_rates_seeded(s, api, owner_a):
    r = s.get(f"{api}/pricing-rates", headers=auth(owner_a["token"]))
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 35, f"expected >=35 rates, got {len(data)}"

def test_pricing_rates_filter(s, api, owner_a):
    r = s.get(f"{api}/pricing-rates?trade=Concreting", headers=auth(owner_a["token"]))
    assert r.status_code == 200
    for row in r.json():
        assert row["trade"] == "Concreting"

# ---- Multi-tenant isolation ----
def test_multitenant_isolation(s, api, owner_a, owner_b):
    # A creates a customer
    r = s.post(f"{api}/customers", json={"name":"TEST_MTCust"}, headers=auth(owner_a["token"]))
    assert r.status_code == 200
    cid = r.json()["id"]
    # B should not see it
    rb = s.get(f"{api}/customers", headers=auth(owner_b["token"]))
    ids = [c["id"] for c in rb.json()]
    assert cid not in ids
    # B cannot fetch by id
    rb2 = s.get(f"{api}/customers/{cid}", headers=auth(owner_b["token"]))
    assert rb2.status_code == 404

# ---- Role permissions ----
def test_employee_cannot_create_job(s, api, owner_a):
    # create EMPLOYEE user under company A
    email = f"emp_{uuid.uuid4().hex[:6]}@t.co"
    r = s.post(f"{api}/users", json={"name":"Emp","email":email,"password":"pass1234","role":"EMPLOYEE"}, headers=auth(owner_a["token"]))
    assert r.status_code == 200
    tok = s.post(f"{api}/auth/login", json={"email":email,"password":"pass1234"}).json()["token"]
    r2 = s.post(f"{api}/jobs", json={"title":"NoAccess"}, headers=auth(tok))
    assert r2.status_code == 403

def test_viewer_cannot_create_customer(s, api, owner_a):
    email = f"view_{uuid.uuid4().hex[:6]}@t.co"
    s.post(f"{api}/users", json={"name":"V","email":email,"password":"pass1234","role":"VIEWER"}, headers=auth(owner_a["token"]))
    tok = s.post(f"{api}/auth/login", json={"email":email,"password":"pass1234"}).json()["token"]
    r = s.post(f"{api}/customers", json={"name":"X"}, headers=auth(tok))
    assert r.status_code == 403
    # can list
    r2 = s.get(f"{api}/customers", headers=auth(tok))
    assert r2.status_code == 200

# ---- CRM lead pipeline ----
def test_lead_pipeline_and_convert(s, api, owner_a):
    h = auth(owner_a["token"])
    r = s.post(f"{api}/leads", json={"title":"TEST_Lead1","contact_name":"John"}, headers=h)
    assert r.status_code == 200
    lid = r.json()["id"]
    for st in ["CONTACTED","QUALIFIED"]:
        rr = s.patch(f"{api}/leads/{lid}/status", json={"status":st}, headers=h)
        assert rr.status_code == 200 and rr.json()["status"] == st
    # note
    rn = s.post(f"{api}/leads/{lid}/notes", json={"body":"Called"}, headers=h)
    assert rn.status_code == 200
    # convert
    rc = s.post(f"{api}/leads/{lid}/convert", json={}, headers=h)
    assert rc.status_code == 200 and rc.json()["customer_id"]
    # verify status CONVERTED
    leads = s.get(f"{api}/leads", headers=h).json()
    lead = next(l for l in leads if l["id"]==lid)
    assert lead["status"] == "CONVERTED"

# ---- Quotes: create, version, status, convert-to-job ----
def test_quote_lifecycle(s, api, owner_a):
    h = auth(owner_a["token"])
    # create customer
    cust = s.post(f"{api}/customers", json={"name":"TEST_QCust"}, headers=h).json()
    q_payload = {
        "title":"TEST_Quote","customer_id":cust["id"],
        "items":[
            {"description":"Concrete","kind":"material","quantity":50,"unit":"m2","unit_rate":120},
            {"description":"Labour","kind":"labour","quantity":10,"unit":"hr","unit_rate":350},
        ],
        "overhead_percentage":10,"profit_percentage":15
    }
    r = s.post(f"{api}/quotes", json=q_payload, headers=h)
    assert r.status_code == 200, r.text
    q = r.json()
    qid = q["id"]
    assert q["breakdown"]["direct_cost"] == 6000 + 3500
    assert q["items"][0]["line_total"] == 6000
    assert q["version"] == 1
    # edit -> version bumps
    q_payload["title"] = "TEST_Quote v2"
    r2 = s.put(f"{api}/quotes/{qid}", json=q_payload, headers=h)
    assert r2.status_code == 200
    assert r2.json()["version"] == 2
    # cannot convert DRAFT
    rc0 = s.post(f"{api}/quotes/{qid}/convert-to-job", headers=h)
    assert rc0.status_code == 400
    # DRAFT->SENT->ACCEPTED
    for st in ["SENT","ACCEPTED"]:
        rs = s.patch(f"{api}/quotes/{qid}/status", json={"status":st}, headers=h)
        assert rs.status_code == 200
    # convert to job
    rc = s.post(f"{api}/quotes/{qid}/convert-to-job", headers=h)
    assert rc.status_code == 200, rc.text
    job = rc.json()["job"]
    assert job["quote_id"] == qid and job["status"] == "SCHEDULED"
    # duplicate should fail
    rc2 = s.post(f"{api}/quotes/{qid}/convert-to-job", headers=h)
    assert rc2.status_code == 400

# ---- Jobs ----
def test_job_operations(s, api, owner_a):
    h = auth(owner_a["token"])
    r = s.post(f"{api}/jobs", json={"title":"TEST_Job"}, headers=h)
    assert r.status_code == 200
    jid = r.json()["id"]
    # progress
    rp = s.patch(f"{api}/jobs/{jid}/progress", json={"progress":50,"status":"IN_PROGRESS"}, headers=h)
    assert rp.status_code == 200
    assert rp.json()["progress"] == 50 and rp.json()["status"] == "IN_PROGRESS"
    # note
    rn = s.post(f"{api}/jobs/{jid}/notes", json={"body":"onsite"}, headers=h)
    assert rn.status_code == 200
    # photo
    rph = s.post(f"{api}/jobs/{jid}/photos", json={"image_base64":"iVBORw0KGgo=","caption":"before"}, headers=h)
    assert rph.status_code == 200
    # detail aggregates
    rd = s.get(f"{api}/jobs/{jid}", headers=h)
    assert rd.status_code == 200
    d = rd.json()
    assert len(d["notes"]) >= 1 and len(d["photos"]) >= 1

# ---- Dashboard ----
def test_dashboard_stats(s, api, owner_a):
    r = s.get(f"{api}/dashboard/stats", headers=auth(owner_a["token"]))
    assert r.status_code == 200
    d = r.json()
    for k in ["open_leads","customers","draft_quotes","accepted_quotes","active_jobs","completed_jobs","pipeline_value"]:
        assert k in d

# CONTRACTOR OS — Full Source Code
Stack: FastAPI + MongoDB (backend) · Expo React Native / expo-router (frontend)

## File Index
- `backend/server.py`
- `backend/estimator.py`
- `backend/seed_data.py`
- `backend/requirements.txt`
- `backend/.env`
- `frontend/package.json`
- `frontend/app.json`
- `frontend/src/theme.ts`
- `frontend/src/api/client.ts`
- `frontend/src/context/AuthContext.tsx`
- `frontend/src/components/ui.tsx`
- `frontend/src/components/Estimator.tsx`
- `frontend/app/_layout.tsx`
- `frontend/app/index.tsx`
- `frontend/app/login.tsx`
- `frontend/app/(tabs)/_layout.tsx`
- `frontend/app/(tabs)/index.tsx`
- `frontend/app/(tabs)/crm.tsx`
- `frontend/app/(tabs)/quotes.tsx`
- `frontend/app/(tabs)/jobs.tsx`

---


## `backend/server.py`

```python
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt

from seed_data import PRICING_SEED
import estimator

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGO = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24 * 7
GST_RATE = 10.0  # Australian GST %

app = FastAPI(title="Contractor OS API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
ROLES = ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE", "VIEWER"]
ROLE_RANK = {"VIEWER": 0, "EMPLOYEE": 1, "MANAGER": 2, "ADMIN": 3, "OWNER": 4}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, company_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "company_id": company_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def strip_mongo(doc: dict) -> dict:
    if doc and "_id" in doc:
        doc = {k: v for k, v in doc.items() if k != "_id"}
    return doc


async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict:
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"], "deleted_at": None})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return strip_mongo(user)


def require_role(min_role: str):
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if ROLE_RANK.get(user["role"], -1) < ROLE_RANK[min_role]:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return checker


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class RegisterInput(BaseModel):
    company_name: str
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    abn: Optional[str] = None


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class ResetRequestInput(BaseModel):
    email: EmailStr


class ResetConfirmInput(BaseModel):
    token: str
    new_password: str = Field(min_length=6)


class UserCreateInput(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    role: str = "EMPLOYEE"


class RoleUpdateInput(BaseModel):
    role: str


class CustomerInput(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    suburb: Optional[str] = None
    notes: Optional[str] = None


class ContactInput(BaseModel):
    customer_id: str
    name: str
    role: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class LeadInput(BaseModel):
    title: str
    customer_id: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    trade: Optional[str] = None
    estimated_value: Optional[float] = 0
    source: Optional[str] = None
    status: str = "NEW"


class LeadStatusInput(BaseModel):
    status: str


class NoteInput(BaseModel):
    body: str


class PricingRateInput(BaseModel):
    trade: str
    category: str
    description: str
    unit: str
    rate: float
    location: str = "Victoria"
    effective_date: Optional[str] = None


class QuoteLineInput(BaseModel):
    description: str
    kind: str = "material"  # material | labour | equipment | subcontractor | delivery | waste
    quantity: float = 1
    unit: str = "unit"
    unit_rate: float = 0
    pricing_rate_id: Optional[str] = None


class QuoteInput(BaseModel):
    customer_id: Optional[str] = None
    lead_id: Optional[str] = None
    title: str
    items: List[QuoteLineInput] = []
    contingency_percentage: float = 0.0
    overhead_percentage: float = 10.0
    profit_percentage: float = 15.0
    valid_days: int = 30


class CalculateInput(BaseModel):
    materials: float = 0
    labour: float = 0
    equipment: float = 0
    subcontractors: float = 0
    delivery: float = 0
    waste: float = 0
    contingency_percentage: float = 0.0
    overhead_percentage: float = 10.0
    profit_percentage: float = 15.0
    gst_rate: float = GST_RATE


class EstimateInput(BaseModel):
    trade: str  # concrete_slab | fencing | retaining_wall | turf | earthworks
    params: Dict[str, Any] = {}


class TemplateInput(BaseModel):
    name: str
    trade: str
    params: Dict[str, Any] = {}


class RecommendInput(BaseModel):
    items: List[QuoteLineInput] = []
    direct_cost: Optional[float] = None


class QuoteStatusInput(BaseModel):
    status: str


class JobInput(BaseModel):
    title: str
    customer_id: Optional[str] = None
    quote_id: Optional[str] = None
    address: Optional[str] = None
    scheduled_date: Optional[str] = None
    status: str = "SCHEDULED"


class TaskInput(BaseModel):
    title: str
    assignee_id: Optional[str] = None
    due_date: Optional[str] = None


class TaskUpdateInput(BaseModel):
    completed: bool


class PhotoInput(BaseModel):
    image_base64: str
    caption: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class JobProgressInput(BaseModel):
    progress: int
    status: Optional[str] = None


# ---------------------------------------------------------------------------
# Calculation engine (shared service)
# ---------------------------------------------------------------------------
def calculate_project_quote(inp: CalculateInput) -> Dict[str, float]:
    direct_cost = round(
        inp.materials + inp.labour + inp.equipment
        + inp.subcontractors + inp.delivery + inp.waste, 2)
    contingency = round(direct_cost * inp.contingency_percentage / 100.0, 2)
    base = round(direct_cost + contingency, 2)
    overheads = round(base * inp.overhead_percentage / 100.0, 2)
    subtotal = round(base + overheads, 2)
    profit = round(subtotal * inp.profit_percentage / 100.0, 2)
    pre_gst = round(subtotal + profit, 2)
    gst = round(pre_gst * inp.gst_rate / 100.0, 2)
    final_total = round(pre_gst + gst, 2)
    return {
        "direct_cost": direct_cost,
        "contingency": contingency,
        "overheads": overheads,
        "profit": profit,
        "gst": gst,
        "pre_gst": pre_gst,
        "final_total": final_total,
    }


def quote_totals_from_items(items: List[dict], overhead_pct: float, profit_pct: float,
                            contingency_pct: float = 0.0) -> Dict[str, Any]:
    buckets = {"materials": 0.0, "labour": 0.0, "equipment": 0.0,
               "subcontractors": 0.0, "delivery": 0.0, "waste": 0.0}
    kind_map = {
        "material": "materials", "materials": "materials",
        "labour": "labour", "labor": "labour",
        "equipment": "equipment",
        "subcontractor": "subcontractors", "subcontractors": "subcontractors",
        "delivery": "delivery", "waste": "waste",
    }
    for it in items:
        line_total = round(it.get("quantity", 0) * it.get("unit_rate", 0), 2)
        bucket = kind_map.get(it.get("kind", "material"), "materials")
        buckets[bucket] += line_total
    calc_in = CalculateInput(
        materials=buckets["materials"], labour=buckets["labour"],
        equipment=buckets["equipment"], subcontractors=buckets["subcontractors"],
        delivery=buckets["delivery"], waste=buckets["waste"],
        contingency_percentage=contingency_pct,
        overhead_percentage=overhead_pct, profit_percentage=profit_pct)
    breakdown = calculate_project_quote(calc_in)
    breakdown["buckets"] = buckets
    return breakdown


# ---------------------------------------------------------------------------
# Generic CRUD helper for company-scoped collections
# ---------------------------------------------------------------------------
async def insert_doc(collection: str, data: dict, user: dict) -> dict:
    doc = {
        **data,
        "id": new_id(),
        "company_id": user["company_id"],
        "created_by": user["id"],
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "deleted_at": None,
    }
    await db[collection].insert_one(doc)
    await audit(user, "create", collection, doc["id"])
    return strip_mongo(doc)


async def list_docs(collection: str, user: dict, extra: dict = None) -> List[dict]:
    q = {"company_id": user["company_id"], "deleted_at": None}
    if extra:
        q.update(extra)
    docs = await db[collection].find(q).sort("created_at", -1).to_list(1000)
    return [strip_mongo(d) for d in docs]


async def get_doc(collection: str, doc_id: str, user: dict) -> dict:
    doc = await db[collection].find_one(
        {"id": doc_id, "company_id": user["company_id"], "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail=f"{collection[:-1]} not found")
    return strip_mongo(doc)


async def update_doc(collection: str, doc_id: str, data: dict, user: dict) -> dict:
    await get_doc(collection, doc_id, user)
    data = {k: v for k, v in data.items() if v is not None}
    data["updated_at"] = now_iso()
    await db[collection].update_one(
        {"id": doc_id, "company_id": user["company_id"]}, {"$set": data})
    await audit(user, "update", collection, doc_id)
    return await get_doc(collection, doc_id, user)


async def soft_delete(collection: str, doc_id: str, user: dict):
    await get_doc(collection, doc_id, user)
    await db[collection].update_one(
        {"id": doc_id, "company_id": user["company_id"]},
        {"$set": {"deleted_at": now_iso(), "updated_at": now_iso()}})
    await audit(user, "delete", collection, doc_id)


async def audit(user: dict, action: str, entity: str, entity_id: str):
    await db.audit_logs.insert_one({
        "id": new_id(),
        "company_id": user["company_id"],
        "user_id": user["id"],
        "action": action,
        "entity": entity,
        "entity_id": entity_id,
        "created_at": now_iso(),
    })


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api_router.post("/auth/register")
async def register(inp: RegisterInput):
    existing = await db.users.find_one({"email": inp.email.lower(), "deleted_at": None})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    company = {
        "id": new_id(), "name": inp.company_name, "abn": inp.abn,
        "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None,
    }
    await db.companies.insert_one(company)
    user = {
        "id": new_id(), "name": inp.name, "email": inp.email.lower(),
        "password_hash": hash_password(inp.password), "role": "OWNER",
        "company_id": company["id"], "created_at": now_iso(),
        "updated_at": now_iso(), "deleted_at": None,
    }
    await db.users.insert_one(user)
    await db.user_companies.insert_one({
        "id": new_id(), "user_id": user["id"], "company_id": company["id"],
        "role": "OWNER", "created_at": now_iso(),
    })
    token = create_token(user["id"], company["id"], "OWNER")
    return {"token": token, "user": _public_user(user), "company": strip_mongo(company)}


@api_router.post("/auth/login")
async def login(inp: LoginInput):
    user = await db.users.find_one({"email": inp.email.lower(), "deleted_at": None})
    if not user or not verify_password(inp.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"], user["company_id"], user["role"])
    company = await db.companies.find_one({"id": user["company_id"]})
    return {"token": token, "user": _public_user(user), "company": strip_mongo(company)}


@api_router.post("/auth/password-reset/request")
async def reset_request(inp: ResetRequestInput):
    user = await db.users.find_one({"email": inp.email.lower(), "deleted_at": None})
    if not user:
        return {"message": "If the account exists, a reset token was generated."}
    reset_token = new_id()
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "reset_token": reset_token,
        "reset_expires": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    }})
    return {"message": "Reset token generated.", "reset_token": reset_token}


@api_router.post("/auth/password-reset/confirm")
async def reset_confirm(inp: ResetConfirmInput):
    user = await db.users.find_one({"reset_token": inp.token, "deleted_at": None})
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    expires = user.get("reset_expires")
    if not expires or datetime.fromisoformat(expires) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    await db.users.update_one({"id": user["id"]}, {
        "$set": {"password_hash": hash_password(inp.new_password), "updated_at": now_iso()},
        "$unset": {"reset_token": "", "reset_expires": ""}})
    return {"message": "Password updated successfully."}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"id": user["company_id"]})
    return {"user": _public_user(user), "company": strip_mongo(company)}


def _public_user(u: dict) -> dict:
    return {"id": u["id"], "name": u["name"], "email": u["email"],
            "role": u["role"], "company_id": u["company_id"]}


# ---------------------------------------------------------------------------
# Users / company
# ---------------------------------------------------------------------------
@api_router.get("/users")
async def list_users(user: dict = Depends(require_role("MANAGER"))):
    users = await db.users.find(
        {"company_id": user["company_id"], "deleted_at": None}).to_list(1000)
    return [_public_user(u) for u in users]


@api_router.post("/users")
async def create_user(inp: UserCreateInput, user: dict = Depends(require_role("ADMIN"))):
    if inp.role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    existing = await db.users.find_one({"email": inp.email.lower(), "deleted_at": None})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    new_user = {
        "id": new_id(), "name": inp.name, "email": inp.email.lower(),
        "password_hash": hash_password(inp.password), "role": inp.role,
        "company_id": user["company_id"], "created_at": now_iso(),
        "updated_at": now_iso(), "deleted_at": None,
    }
    await db.users.insert_one(new_user)
    await db.user_companies.insert_one({
        "id": new_id(), "user_id": new_user["id"], "company_id": user["company_id"],
        "role": inp.role, "created_at": now_iso()})
    return _public_user(new_user)


@api_router.patch("/users/{user_id}/role")
async def update_role(user_id: str, inp: RoleUpdateInput, user: dict = Depends(require_role("ADMIN"))):
    if inp.role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    target = await db.users.find_one({"id": user_id, "company_id": user["company_id"]})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one({"id": user_id}, {"$set": {"role": inp.role, "updated_at": now_iso()}})
    return {"message": "Role updated"}


# ---------------------------------------------------------------------------
# Customers / Contacts
# ---------------------------------------------------------------------------
@api_router.get("/customers")
async def get_customers(user: dict = Depends(get_current_user)):
    return await list_docs("customers", user)


@api_router.post("/customers")
async def create_customer(inp: CustomerInput, user: dict = Depends(require_role("EMPLOYEE"))):
    return await insert_doc("customers", inp.dict(), user)


@api_router.get("/customers/{cid}")
async def customer_detail(cid: str, user: dict = Depends(get_current_user)):
    cust = await get_doc("customers", cid, user)
    cust["contacts"] = await list_docs("contacts", user, {"customer_id": cid})
    return cust


@api_router.put("/customers/{cid}")
async def edit_customer(cid: str, inp: CustomerInput, user: dict = Depends(require_role("EMPLOYEE"))):
    return await update_doc("customers", cid, inp.dict(), user)


@api_router.delete("/customers/{cid}")
async def del_customer(cid: str, user: dict = Depends(require_role("MANAGER"))):
    await soft_delete("customers", cid, user)
    return {"message": "deleted"}


@api_router.post("/contacts")
async def create_contact(inp: ContactInput, user: dict = Depends(require_role("EMPLOYEE"))):
    await get_doc("customers", inp.customer_id, user)
    return await insert_doc("contacts", inp.dict(), user)


@api_router.get("/contacts")
async def get_contacts(user: dict = Depends(get_current_user)):
    return await list_docs("contacts", user)


# ---------------------------------------------------------------------------
# Leads (pipeline)
# ---------------------------------------------------------------------------
LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"]


@api_router.get("/leads")
async def get_leads(user: dict = Depends(get_current_user)):
    return await list_docs("leads", user)


@api_router.post("/leads")
async def create_lead(inp: LeadInput, user: dict = Depends(require_role("EMPLOYEE"))):
    if inp.status not in LEAD_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    return await insert_doc("leads", inp.dict(), user)


@api_router.patch("/leads/{lid}/status")
async def lead_status(lid: str, inp: LeadStatusInput, user: dict = Depends(require_role("EMPLOYEE"))):
    if inp.status not in LEAD_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    return await update_doc("leads", lid, {"status": inp.status}, user)


@api_router.post("/leads/{lid}/convert")
async def convert_lead(lid: str, user: dict = Depends(require_role("MANAGER"))):
    lead = await get_doc("leads", lid, user)
    customer_id = lead.get("customer_id")
    if not customer_id:
        cust = await insert_doc("customers", {
            "name": lead.get("contact_name") or lead["title"],
            "email": lead.get("contact_email"), "phone": lead.get("contact_phone"),
        }, user)
        customer_id = cust["id"]
    await update_doc("leads", lid, {"status": "CONVERTED", "customer_id": customer_id}, user)
    return {"message": "Lead converted", "customer_id": customer_id}


@api_router.post("/leads/{lid}/notes")
async def add_lead_note(lid: str, inp: NoteInput, user: dict = Depends(require_role("EMPLOYEE"))):
    await get_doc("leads", lid, user)
    return await insert_doc("activity_logs", {
        "entity": "lead", "entity_id": lid, "type": "note", "body": inp.body}, user)


@api_router.get("/leads/{lid}/notes")
async def get_lead_notes(lid: str, user: dict = Depends(get_current_user)):
    return await list_docs("activity_logs", user, {"entity": "lead", "entity_id": lid})


# ---------------------------------------------------------------------------
# Pricing rates
# ---------------------------------------------------------------------------
@api_router.get("/pricing-rates")
async def get_rates(trade: Optional[str] = None, category: Optional[str] = None,
                    location: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"deleted_at": None}
    q["$or"] = [{"company_id": user["company_id"]}, {"company_id": None}]
    if trade:
        q["trade"] = trade
    if category:
        q["category"] = category
    if location:
        q["location"] = location
    docs = await db.pricing_rates.find(q).sort("trade", 1).to_list(2000)
    return [strip_mongo(d) for d in docs]


@api_router.post("/pricing-rates")
async def create_rate(inp: PricingRateInput, user: dict = Depends(require_role("ADMIN"))):
    data = inp.dict()
    data["effective_date"] = data.get("effective_date") or now_iso()
    return await insert_doc("pricing_rates", data, user)


@api_router.put("/pricing-rates/{rid}")
async def edit_rate(rid: str, inp: PricingRateInput, user: dict = Depends(require_role("ADMIN"))):
    return await update_doc("pricing_rates", rid, inp.dict(), user)


@api_router.delete("/pricing-rates/{rid}")
async def del_rate(rid: str, user: dict = Depends(require_role("ADMIN"))):
    rate = await db.pricing_rates.find_one({"id": rid})
    if rate and rate.get("company_id") is None:
        raise HTTPException(status_code=403, detail="Cannot delete global seeded rate")
    await soft_delete("pricing_rates", rid, user)
    return {"message": "deleted"}


# ---------------------------------------------------------------------------
# Calculation engine endpoint
# ---------------------------------------------------------------------------
def recommend_margins(direct_cost: float, descriptions: List[str]) -> Dict[str, Any]:
    """Suggest contingency / overhead / profit % from job size and risk profile.
    Heuristic industry defaults for VIC contractors — always editable by the user."""
    text = " ".join(descriptions).lower()
    high_risk_kw = ["earthwork", "excavat", "retaining", "sleeper", "cut & fill",
                    "soil", "tipper", "drainage", "backfill", "footing"]
    med_risk_kw = ["concrete", "slab", "paving", "crushed rock"]
    if any(k in text for k in high_risk_kw):
        risk = "high"
    elif any(k in text for k in med_risk_kw):
        risk = "medium"
    else:
        risk = "low"
    contingency = {"low": 5.0, "medium": 7.5, "high": 10.0}[risk]
    if direct_cost < 2000:
        contingency += 2.5  # small jobs carry more estimate risk

    # Overhead & profit scale inversely with job size (fixed costs spread further,
    # large jobs are more competitive)
    if direct_cost < 5000:
        overhead, profit, band = 15.0, 25.0, "small (< $5k)"
    elif direct_cost < 20000:
        overhead, profit, band = 12.0, 20.0, "$5k–$20k"
    elif direct_cost < 50000:
        overhead, profit, band = 10.0, 17.5, "$20k–$50k"
    elif direct_cost < 150000:
        overhead, profit, band = 8.0, 15.0, "$50k–$150k"
    else:
        overhead, profit, band = 6.0, 12.0, "large (> $150k)"

    rationale = [
        f"{risk.title()}-risk work → {contingency}% contingency",
        f"Job size {band} → {overhead}% overheads",
        f"{profit}% profit margin for this job size",
    ]
    return {"contingency": round(contingency, 1), "overhead": overhead,
            "profit": profit, "risk": risk, "direct_cost": round(direct_cost, 2),
            "rationale": rationale}


@api_router.post("/recommend-margins")
async def recommend_margins_endpoint(inp: RecommendInput, user: dict = Depends(get_current_user)):
    if inp.direct_cost is not None:
        direct_cost = inp.direct_cost
    else:
        direct_cost = sum(round(i.quantity * i.unit_rate, 2) for i in inp.items)
    descriptions = [i.description for i in inp.items]
    return recommend_margins(direct_cost, descriptions)


@api_router.post("/calculate-quote")
async def calc_quote(inp: CalculateInput, user: dict = Depends(get_current_user)):
    return calculate_project_quote(inp)


@api_router.post("/estimate-materials")
async def estimate_materials(inp: EstimateInput, user: dict = Depends(get_current_user)):
    """Takeoff calculator: dimensions -> material quantities, priced from pricing_rates."""
    try:
        items, assumptions = estimator.estimate(inp.trade, inp.params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Load available rates once (company custom + global seeded)
    rates = await db.pricing_rates.find({
        "deleted_at": None,
        "$or": [{"company_id": user["company_id"]}, {"company_id": None}],
    }).to_list(2000)
    enriched = []
    subtotal = 0.0
    for it in items:
        match = it.pop("match", "").lower()
        rate_doc = None
        for r in rates:
            if match and match in r.get("description", "").lower():
                rate_doc = r
                break
        unit_rate = float(rate_doc["rate"]) if rate_doc else 0.0
        rate_id = rate_doc["id"] if rate_doc else None
        line_total = round(it["quantity"] * unit_rate, 2)
        subtotal += line_total
        enriched.append({**it, "unit_rate": unit_rate, "pricing_rate_id": rate_id,
                         "line_total": line_total})
    return {"trade": inp.trade, "assumptions": assumptions,
            "items": enriched, "materials_subtotal": round(subtotal, 2)}


@api_router.get("/estimate-templates")
async def list_templates(user: dict = Depends(get_current_user)):
    return await list_docs("estimate_templates", user)


@api_router.post("/estimate-templates")
async def create_template(inp: TemplateInput, user: dict = Depends(require_role("EMPLOYEE"))):
    return await insert_doc("estimate_templates", inp.dict(), user)


@api_router.delete("/estimate-templates/{tid}")
async def delete_template(tid: str, user: dict = Depends(require_role("EMPLOYEE"))):
    await soft_delete("estimate_templates", tid, user)
    return {"message": "deleted"}


# ---------------------------------------------------------------------------
# Quotes
# ---------------------------------------------------------------------------
QUOTE_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"]


async def next_quote_number(company_id: str) -> str:
    count = await db.quotes.count_documents({"company_id": company_id})
    return f"Q-{count + 1:04d}"


@api_router.get("/quotes")
async def get_quotes(user: dict = Depends(get_current_user)):
    return await list_docs("quotes", user)


@api_router.post("/quotes")
async def create_quote(inp: QuoteInput, user: dict = Depends(require_role("EMPLOYEE"))):
    items = [i.dict() for i in inp.items]
    for it in items:
        it["id"] = new_id()
        it["line_total"] = round(it["quantity"] * it["unit_rate"], 2)
    breakdown = quote_totals_from_items(items, inp.overhead_percentage, inp.profit_percentage, inp.contingency_percentage)
    data = {
        "quote_number": await next_quote_number(user["company_id"]),
        "customer_id": inp.customer_id, "lead_id": inp.lead_id, "title": inp.title,
        "items": items, "overhead_percentage": inp.overhead_percentage,
        "profit_percentage": inp.profit_percentage,
        "contingency_percentage": inp.contingency_percentage, "status": "DRAFT",
        "breakdown": breakdown, "version": 1,
        "valid_until": (datetime.now(timezone.utc) + timedelta(days=inp.valid_days)).isoformat(),
    }
    quote = await insert_doc("quotes", data, user)
    await _snapshot_version(quote, user)
    return quote


@api_router.get("/quotes/{qid}")
async def quote_detail(qid: str, user: dict = Depends(get_current_user)):
    quote = await get_doc("quotes", qid, user)
    quote["versions"] = await list_docs("quote_versions", user, {"quote_id": qid})
    return quote


@api_router.put("/quotes/{qid}")
async def edit_quote(qid: str, inp: QuoteInput, user: dict = Depends(require_role("EMPLOYEE"))):
    existing = await get_doc("quotes", qid, user)
    if existing["status"] not in ["DRAFT", "SENT"]:
        raise HTTPException(status_code=400, detail="Only draft/sent quotes can be edited")
    items = [i.dict() for i in inp.items]
    for it in items:
        it["id"] = new_id()
        it["line_total"] = round(it["quantity"] * it["unit_rate"], 2)
    breakdown = quote_totals_from_items(items, inp.overhead_percentage, inp.profit_percentage, inp.contingency_percentage)
    data = {
        "customer_id": inp.customer_id, "title": inp.title, "items": items,
        "overhead_percentage": inp.overhead_percentage,
        "profit_percentage": inp.profit_percentage,
        "contingency_percentage": inp.contingency_percentage, "breakdown": breakdown,
        "version": existing["version"] + 1,
    }
    updated = await update_doc("quotes", qid, data, user)
    await _snapshot_version(updated, user)
    return updated


@api_router.post("/quotes/{qid}/calculate")
async def recalc_quote(qid: str, user: dict = Depends(get_current_user)):
    quote = await get_doc("quotes", qid, user)
    breakdown = quote_totals_from_items(
        quote["items"], quote["overhead_percentage"], quote["profit_percentage"],
        quote.get("contingency_percentage", 0.0))
    await db.quotes.update_one({"id": qid, "company_id": user["company_id"]},
                               {"$set": {"breakdown": breakdown, "updated_at": now_iso()}})
    return breakdown


@api_router.patch("/quotes/{qid}/status")
async def quote_status(qid: str, inp: QuoteStatusInput, user: dict = Depends(require_role("EMPLOYEE"))):
    if inp.status not in QUOTE_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    return await update_doc("quotes", qid, {"status": inp.status}, user)


async def _snapshot_version(quote: dict, user: dict):
    await db.quote_versions.insert_one({
        "id": new_id(), "quote_id": quote["id"], "company_id": user["company_id"],
        "version": quote["version"], "items": quote["items"],
        "breakdown": quote["breakdown"], "created_at": now_iso(), "deleted_at": None,
    })


@api_router.post("/quotes/{qid}/convert-to-job")
async def convert_quote_to_job(qid: str, user: dict = Depends(require_role("MANAGER"))):
    quote = await get_doc("quotes", qid, user)
    if quote["status"] != "ACCEPTED":
        raise HTTPException(status_code=400, detail="Only accepted quotes can convert to a job")
    existing_job = await db.jobs.find_one(
        {"quote_id": qid, "company_id": user["company_id"], "deleted_at": None})
    if existing_job:
        raise HTTPException(status_code=400, detail="Job already exists for this quote")
    job = await insert_doc("jobs", {
        "title": quote["title"], "customer_id": quote.get("customer_id"),
        "quote_id": qid, "status": "SCHEDULED", "progress": 0,
        "value": quote["breakdown"]["final_total"],
    }, user)
    return {"message": "Job created", "job": job}


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------
JOB_STATUSES = ["SCHEDULED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "INVOICED", "CANCELLED"]


@api_router.get("/jobs")
async def get_jobs(status_filter: Optional[str] = None, today: Optional[bool] = False,
                   user: dict = Depends(get_current_user)):
    extra = {}
    if status_filter:
        extra["status"] = status_filter
    if today:
        extra["scheduled_date"] = {"$regex": f"^{datetime.now(timezone.utc).date().isoformat()}"}
    return await list_docs("jobs", user, extra)


@api_router.post("/jobs")
async def create_job(inp: JobInput, user: dict = Depends(require_role("MANAGER"))):
    data = inp.dict()
    data["progress"] = 0
    return await insert_doc("jobs", data, user)


@api_router.get("/jobs/{jid}")
async def job_detail(jid: str, user: dict = Depends(get_current_user)):
    job = await get_doc("jobs", jid, user)
    job["tasks"] = await list_docs("job_tasks", user, {"job_id": jid})
    job["photos"] = await list_docs("job_photos", user, {"job_id": jid})
    job["notes"] = await list_docs("job_notes", user, {"job_id": jid})
    job["documents"] = await list_docs("documents", user, {"job_id": jid})
    return job


@api_router.patch("/jobs/{jid}/progress")
async def job_progress(jid: str, inp: JobProgressInput, user: dict = Depends(require_role("EMPLOYEE"))):
    data = {"progress": max(0, min(100, inp.progress))}
    if inp.status:
        if inp.status not in JOB_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        data["status"] = inp.status
    return await update_doc("jobs", jid, data, user)


@api_router.post("/jobs/{jid}/tasks")
async def add_task(jid: str, inp: TaskInput, user: dict = Depends(require_role("EMPLOYEE"))):
    await get_doc("jobs", jid, user)
    data = inp.dict()
    data["job_id"] = jid
    data["completed"] = False
    return await insert_doc("job_tasks", data, user)


@api_router.patch("/jobs/{jid}/tasks/{tid}")
async def toggle_task(jid: str, tid: str, inp: TaskUpdateInput, user: dict = Depends(require_role("EMPLOYEE"))):
    return await update_doc("job_tasks", tid, {"completed": inp.completed}, user)


@api_router.post("/jobs/{jid}/photos")
async def add_photo(jid: str, inp: PhotoInput, user: dict = Depends(require_role("EMPLOYEE"))):
    await get_doc("jobs", jid, user)
    data = inp.dict()
    data["job_id"] = jid
    return await insert_doc("job_photos", data, user)


@api_router.post("/jobs/{jid}/notes")
async def add_job_note(jid: str, inp: NoteInput, user: dict = Depends(require_role("EMPLOYEE"))):
    await get_doc("jobs", jid, user)
    return await insert_doc("job_notes", {"job_id": jid, "body": inp.body}, user)


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@api_router.get("/dashboard/stats")
async def dashboard_stats(user: dict = Depends(get_current_user)):
    cid = user["company_id"]
    base = {"company_id": cid, "deleted_at": None}
    open_leads = await db.leads.count_documents({**base, "status": {"$nin": ["CONVERTED", "LOST"]}})
    customers = await db.customers.count_documents(base)
    draft_quotes = await db.quotes.count_documents({**base, "status": "DRAFT"})
    accepted_quotes = await db.quotes.count_documents({**base, "status": "ACCEPTED"})
    active_jobs = await db.jobs.count_documents({**base, "status": {"$in": ["SCHEDULED", "IN_PROGRESS"]}})
    completed_jobs = await db.jobs.count_documents({**base, "status": "COMPLETED"})
    pipeline_value = 0.0
    async for q in db.quotes.find({**base, "status": {"$in": ["SENT", "ACCEPTED"]}}):
        pipeline_value += q.get("breakdown", {}).get("final_total", 0)
    return {
        "open_leads": open_leads, "customers": customers,
        "draft_quotes": draft_quotes, "accepted_quotes": accepted_quotes,
        "active_jobs": active_jobs, "completed_jobs": completed_jobs,
        "pipeline_value": round(pipeline_value, 2),
    }


@api_router.get("/")
async def root():
    return {"message": "Contractor OS API", "status": "ok"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Startup: indexes + seed pricing
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email")
    await db.users.create_index("company_id")
    for coll in ["customers", "contacts", "leads", "quotes", "jobs", "job_tasks",
                 "job_photos", "job_notes", "documents", "pricing_rates",
                 "quote_versions", "activity_logs", "audit_logs"]:
        await db[coll].create_index("company_id")
    existing = await db.pricing_rates.count_documents({"company_id": None})
    if existing == 0:
        docs = []
        for r in PRICING_SEED:
            docs.append({
                "id": new_id(), "company_id": None, **r,
                "location": "Victoria", "effective_date": now_iso(),
                "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None,
            })
        if docs:
            await db.pricing_rates.insert_many(docs)
        logger.info(f"Seeded {len(docs)} Victoria pricing rates")
    else:
        # Idempotently ensure any newly added seed rates exist (matched by description)
        added = 0
        for r in PRICING_SEED:
            found = await db.pricing_rates.find_one(
                {"company_id": None, "description": r["description"]})
            if not found:
                await db.pricing_rates.insert_one({
                    "id": new_id(), "company_id": None, **r,
                    "location": "Victoria", "effective_date": now_iso(),
                    "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None,
                })
                added += 1
        if added:
            logger.info(f"Added {added} new Victoria pricing rates")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

```


## `backend/estimator.py`

```python
"""Materials takeoff / quantity estimator.

Converts project DIMENSIONS into MATERIAL QUANTITIES per trade.
All engineering assumptions (sheet coverage, sleeper size, truck capacity, waste)
are exposed as overridable params with transparent defaults — nothing hidden.
Pricing itself is NEVER hard-coded here; the server attaches rates from pricing_rates
by matching the `match` keyword.
"""
import math
from typing import Dict, List, Any


def _num(p: dict, key: str, default: float) -> float:
    try:
        v = p.get(key)
        return float(v) if v not in (None, "") else float(default)
    except (TypeError, ValueError):
        return float(default)


def _line(description, kind, unit, quantity, match):
    return {"description": description, "kind": kind, "unit": unit,
            "quantity": round(quantity, 2), "match": match}


def concrete_slab(p: dict):
    area = _num(p, "area_m2", 0)
    thickness_mm = _num(p, "thickness_mm", 100)
    coverage = _num(p, "mesh_sheet_coverage_m2", 12.5)   # SL72 sheet w/ 200mm laps
    chairs_per_m2 = _num(p, "bar_chairs_per_m2", 3.5)
    waste = _num(p, "waste_pct", 5) / 100.0
    base_depth = _num(p, "base_depth_m", 0.10)           # compacted road base under slab
    rock_density = _num(p, "rock_density_t_m3", 2.0)
    sand_depth = _num(p, "sand_bedding_depth_m", 0.03)   # blinding sand layer
    sand_density = _num(p, "sand_density_t_m3", 1.5)
    concrete_m3 = area * (thickness_mm / 1000.0) * (1 + waste)
    sheets = math.ceil(area / coverage) if area > 0 and coverage > 0 else 0
    chairs = math.ceil(area * chairs_per_m2)
    crushed_rock_t = area * base_depth * rock_density
    sand_t = area * sand_depth * sand_density
    assumptions = {
        "mesh_sheet_coverage_m2": coverage, "bar_chairs_per_m2": chairs_per_m2,
        "thickness_mm": thickness_mm, "waste_pct": _num(p, "waste_pct", 5),
        "base_depth_m": base_depth, "rock_density_t_m3": rock_density,
        "sand_bedding_depth_m": sand_depth,
    }
    items = [
        _line(f"Concrete slab supply & lay {int(thickness_mm)}mm", "material", "m2", area, "concrete slab"),
        _line("Crushed rock 20mm (base)", "material", "tonne", crushed_rock_t, "crushed rock"),
        _line("Sand - bedding", "material", "tonne", sand_t, "sand - bedding"),
        _line("Reinforcing mesh SL72", "material", "sheet", sheets, "reinforcing mesh"),
        _line("Bar chairs (plastic 50mm)", "material", "unit", chairs, "bar chairs"),
        _line("Concrete supply (volume incl. waste)", "material", "m3", concrete_m3, "reinforced concrete footing"),
    ]
    return items, assumptions


def fencing(p: dict):
    length = _num(p, "length_m", 0)
    panel_w = _num(p, "panel_width_m", 2.4)
    bags_per_post = _num(p, "cement_bags_per_post", 2)
    rock_per_post = _num(p, "rock_m3_per_post", 0.02)     # road base per post footing
    sand_per_post = _num(p, "sand_m3_per_post", 0.01)
    rock_density = _num(p, "rock_density_t_m3", 2.0)
    sand_density = _num(p, "sand_density_t_m3", 1.5)
    panels = math.ceil(length / panel_w) if length > 0 and panel_w > 0 else 0
    posts = panels + 1 if panels > 0 else 0
    cement_bags = math.ceil(posts * bags_per_post)
    crushed_rock_t = posts * rock_per_post * rock_density
    sand_t = posts * sand_per_post * sand_density
    assumptions = {"panel_width_m": panel_w, "posts_rule": "panels + 1 (end post each side)",
                   "cement_bags_per_post": bags_per_post, "rock_m3_per_post": rock_per_post,
                   "sand_m3_per_post": sand_per_post}
    items = [
        _line("Colorbond panel 2.4m x 1.8m", "material", "panel", panels, "colorbond panel"),
        _line("Fence post + concrete footing", "material", "unit", posts, "fence post"),
        _line("Cement bag 20kg (post footings)", "material", "bag", cement_bags, "cement bag"),
        _line("Crushed rock 20mm (footing base)", "material", "tonne", crushed_rock_t, "crushed rock"),
        _line("Sand - bedding", "material", "tonne", sand_t, "sand - bedding"),
        _line("Fencing labour", "labour", "day", math.ceil(length / 30) if length else 0, "fencing labourer"),
        _line("Materials delivery (local)", "delivery", "load", 1 if posts > 0 else 0, "materials delivery"),
    ]
    return items, assumptions


def retaining_wall(p: dict):
    length = _num(p, "length_m", 0)
    height = _num(p, "height_m", 0)
    sleeper_len = _num(p, "sleeper_length_m", 2.0)
    sleeper_h = _num(p, "sleeper_height_m", 0.2)
    bags_per_post = _num(p, "cement_bags_per_post", 4)
    backfill_thickness = _num(p, "drainage_backfill_thickness_m", 0.3)   # crushed rock behind wall
    base_bedding_m3_per_m = _num(p, "base_bedding_m3_per_m", 0.03)        # sand base per lineal m
    rock_density = _num(p, "rock_density_t_m3", 2.0)
    sand_density = _num(p, "sand_density_t_m3", 1.5)
    bays = math.ceil(length / sleeper_len) if length > 0 and sleeper_len > 0 else 0
    courses = math.ceil(height / sleeper_h) if height > 0 and sleeper_h > 0 else 0
    sleepers = bays * courses
    posts_total = bays + 1 if bays > 0 else 0
    end_beams = 2 if posts_total >= 2 else posts_total
    h_beams = max(posts_total - 2, 0)
    cement_bags = math.ceil(posts_total * bags_per_post)
    crushed_rock_t = length * height * backfill_thickness * rock_density
    sand_t = length * base_bedding_m3_per_m * sand_density
    assumptions = {
        "sleeper_length_m": sleeper_len, "sleeper_height_m": sleeper_h,
        "bays": bays, "courses": courses,
        "posts_rule": "bays + 1 (2 end beams, remainder H-beams)",
        "cement_bags_per_post": bags_per_post,
        "drainage_backfill_thickness_m": backfill_thickness,
        "base_bedding_m3_per_m": base_bedding_m3_per_m,
    }
    items = [
        _line("Concrete sleeper 2.0m x 200mm", "material", "unit", sleepers, "concrete sleeper 2"),
        _line("Galvanised H-beam post 1.5m", "material", "unit", h_beams, "h-beam post"),
        _line("Retaining wall end beam (C-section)", "material", "unit", end_beams, "end beam"),
        _line("Cement bag 20kg (post footings)", "material", "bag", cement_bags, "cement bag"),
        _line("Crushed rock 20mm (drainage backfill)", "material", "tonne", crushed_rock_t, "crushed rock"),
        _line("Sand - bedding (base)", "material", "tonne", sand_t, "sand - bedding"),
        _line("Ag drain & drainage aggregate", "material", "m", length, "ag drain"),
        _line("Materials delivery (local)", "delivery", "load", 1 if posts_total > 0 else 0, "materials delivery"),
    ]
    return items, assumptions


def turf(p: dict):
    area = _num(p, "area_m2", 0)
    waste = _num(p, "waste_pct", 5) / 100.0
    bags_per_m2 = _num(p, "cement_bags_per_m2", 0.05)
    turf_m2 = area * (1 + waste)
    cement_bags = math.ceil(area * bags_per_m2)
    assumptions = {"waste_pct": _num(p, "waste_pct", 5), "cement_bags_per_m2": bags_per_m2}
    items = [
        _line("Turf supply & lay (Sir Walter)", "material", "m2", turf_m2, "turf supply"),
        _line("Garden bed soil", "material", "m3", area * 0.1, "garden bed soil"),
        _line("Cement bag 20kg (edging/mowing strip)", "material", "bag", cement_bags, "cement bag"),
        _line("Materials delivery (local)", "delivery", "load", 1 if area > 0 else 0, "materials delivery"),
    ]
    return items, assumptions


def earthworks(p: dict):
    area = _num(p, "area_m2", 0)
    depth = _num(p, "depth_m", 0.3)
    bulking = _num(p, "bulking_factor", 1.25)
    truck_cap = _num(p, "truck_capacity_m3", 6.0)
    excavation = area * depth
    spoil = excavation * bulking
    loads = math.ceil(spoil / truck_cap) if spoil > 0 and truck_cap > 0 else 0
    assumptions = {
        "depth_m": depth, "bulking_factor": bulking, "truck_capacity_m3": truck_cap,
        "spoil_rule": "excavation × bulking factor",
    }
    items = [
        _line("Site cut & fill", "material", "m3", excavation, "site cut"),
        _line("Soil disposal / tip fees", "material", "m3", spoil, "soil disposal"),
        _line("Tandem tipper load (6m3) cartage", "equipment", "load", loads, "tipper load"),
        _line("Excavator 5T + operator", "equipment", "hour", math.ceil(excavation / 8) if excavation else 0, "excavator 5t"),
    ]
    return items, assumptions


ESTIMATORS = {
    "concrete_slab": concrete_slab,
    "fencing": fencing,
    "retaining_wall": retaining_wall,
    "turf": turf,
    "earthworks": earthworks,
}


def estimate(trade: str, params: dict):
    fn = ESTIMATORS.get(trade)
    if not fn:
        raise ValueError(f"Unknown trade '{trade}'. Options: {list(ESTIMATORS)}")
    items, assumptions = fn(params or {})
    items = [i for i in items if i["quantity"] > 0]
    return items, assumptions

```


## `backend/seed_data.py`

```python
# Realistic Victoria (Australia) contractor pricing rates.
# These are sample market rates for seeding; edit via the pricing DB, never hard-coded in logic.

PRICING_SEED = [
    # Concrete
    {"trade": "Concrete", "category": "Materials", "description": "Concrete slab supply & lay 100mm", "unit": "m2", "rate": 120.0},
    {"trade": "Concrete", "category": "Materials", "description": "Concrete driveway exposed aggregate", "unit": "m2", "rate": 165.0},
    {"trade": "Concrete", "category": "Materials", "description": "Reinforced concrete footing", "unit": "m3", "rate": 380.0},
    {"trade": "Concrete", "category": "Labour", "description": "Concrete finisher", "unit": "day", "rate": 480.0},
    {"trade": "Concrete", "category": "Materials", "description": "Concrete pump hire", "unit": "day", "rate": 950.0},

    # Earthworks
    {"trade": "Earthworks", "category": "Equipment", "description": "Excavator 5T + operator", "unit": "hour", "rate": 145.0},
    {"trade": "Earthworks", "category": "Equipment", "description": "Bobcat / skid steer + operator", "unit": "hour", "rate": 120.0},
    {"trade": "Earthworks", "category": "Materials", "description": "Site cut & fill", "unit": "m3", "rate": 55.0},
    {"trade": "Earthworks", "category": "Materials", "description": "Soil disposal / tip fees", "unit": "m3", "rate": 65.0},
    {"trade": "Earthworks", "category": "Equipment", "description": "Tandem tipper truck", "unit": "hour", "rate": 135.0},

    # Fencing
    {"trade": "Fencing", "category": "Materials", "description": "Colorbond fence 1.8m supply & install", "unit": "m", "rate": 95.0},
    {"trade": "Fencing", "category": "Materials", "description": "Timber paling fence 1.8m", "unit": "m", "rate": 85.0},
    {"trade": "Fencing", "category": "Materials", "description": "Gate - single pedestrian", "unit": "unit", "rate": 350.0},
    {"trade": "Fencing", "category": "Labour", "description": "Fencing labourer", "unit": "day", "rate": 420.0},

    # Landscaping
    {"trade": "Landscaping", "category": "Materials", "description": "Turf supply & lay (Sir Walter)", "unit": "m2", "rate": 22.0},
    {"trade": "Landscaping", "category": "Materials", "description": "Mulch supply & spread", "unit": "m2", "rate": 12.0},
    {"trade": "Landscaping", "category": "Materials", "description": "Paving supply & lay", "unit": "m2", "rate": 145.0},
    {"trade": "Landscaping", "category": "Labour", "description": "Landscaper", "unit": "day", "rate": 440.0},
    {"trade": "Landscaping", "category": "Materials", "description": "Garden bed soil (m3)", "unit": "m3", "rate": 85.0},

    # Retaining walls
    {"trade": "Retaining Walls", "category": "Materials", "description": "Besser block retaining wall", "unit": "m2", "rate": 320.0},
    {"trade": "Retaining Walls", "category": "Materials", "description": "Timber sleeper retaining wall", "unit": "m2", "rate": 240.0},
    {"trade": "Retaining Walls", "category": "Materials", "description": "Concrete sleeper retaining wall", "unit": "m2", "rate": 290.0},
    {"trade": "Retaining Walls", "category": "Materials", "description": "Ag drain & drainage aggregate", "unit": "m", "rate": 45.0},

    # Materials (general)
    {"trade": "Materials", "category": "Materials", "description": "Crushed rock 20mm", "unit": "tonne", "rate": 62.0},
    {"trade": "Materials", "category": "Materials", "description": "Sand - bedding", "unit": "tonne", "rate": 68.0},
    {"trade": "Materials", "category": "Materials", "description": "Reinforcing mesh SL72", "unit": "sheet", "rate": 95.0},
    {"trade": "Materials", "category": "Materials", "description": "Cement bag 20kg", "unit": "bag", "rate": 12.0},

    # Labour
    {"trade": "Labour", "category": "Labour", "description": "General labourer", "unit": "day", "rate": 350.0},
    {"trade": "Labour", "category": "Labour", "description": "Skilled tradesperson", "unit": "day", "rate": 520.0},
    {"trade": "Labour", "category": "Labour", "description": "Leading hand / supervisor", "unit": "day", "rate": 620.0},
    {"trade": "Labour", "category": "Labour", "description": "Apprentice", "unit": "day", "rate": 240.0},

    # Equipment
    {"trade": "Equipment", "category": "Equipment", "description": "Excavator 1.7T (dry hire)", "unit": "day", "rate": 320.0},
    {"trade": "Equipment", "category": "Equipment", "description": "Plate compactor", "unit": "day", "rate": 95.0},
    {"trade": "Equipment", "category": "Equipment", "description": "Concrete mixer", "unit": "day", "rate": 80.0},
    {"trade": "Equipment", "category": "Equipment", "description": "Scaffolding (per bay/week)", "unit": "week", "rate": 55.0},

    # Takeoff materials (used by the quantity estimator)
    {"trade": "Concrete", "category": "Materials", "description": "Bar chairs (plastic 50mm)", "unit": "unit", "rate": 0.45},
    {"trade": "Fencing", "category": "Materials", "description": "Colorbond panel 2.4m x 1.8m", "unit": "panel", "rate": 220.0},
    {"trade": "Fencing", "category": "Materials", "description": "Fence post + concrete footing", "unit": "unit", "rate": 65.0},
    {"trade": "Retaining Walls", "category": "Materials", "description": "Concrete sleeper 2.0m x 200mm", "unit": "unit", "rate": 48.0},
    {"trade": "Retaining Walls", "category": "Materials", "description": "Galvanised H-beam post 1.5m", "unit": "unit", "rate": 95.0},
    {"trade": "Retaining Walls", "category": "Materials", "description": "Retaining wall end beam (C-section)", "unit": "unit", "rate": 85.0},
    {"trade": "Earthworks", "category": "Equipment", "description": "Tandem tipper load (6m3) cartage", "unit": "load", "rate": 240.0},
    {"trade": "Materials", "category": "Materials", "description": "Materials delivery (local)", "unit": "load", "rate": 120.0},
]

```


## `backend/requirements.txt`

```text
fastapi==0.110.1
uvicorn==0.25.0
boto3>=1.34.129
requests-oauthlib>=2.0.0
cryptography>=42.0.8
python-dotenv>=1.0.1
pymongo==4.6.3
pydantic>=2.6.4
email-validator>=2.2.0
pyjwt>=2.10.1
bcrypt==4.1.3
passlib>=1.7.4
tzdata>=2024.2
motor==3.3.1
pytest>=8.0.0
black>=24.1.1
isort>=5.13.2
flake8>=7.0.0
mypy>=1.8.0
python-jose>=3.3.0
requests>=2.31.0
pandas>=2.2.0
numpy>=1.26.0
python-multipart>=0.0.9
jq>=1.6.0
typer>=0.9.0
emergentintegrations==0.2.0
```


## `backend/.env`

```bash
MONGO_URL="mongodb://localhost:27017"
DB_NAME="test_database"
JWT_SECRET="<your-secret-here>"
```


## `frontend/package.json`

```json
{
  "name": "frontend",
  "main": "expo-router/entry",
  "version": "1.0.0",
  "scripts": {
    "preinstall": "./scripts/cmd-guard.js --preinstall",
    "start": "expo start",
    "reset-project": "node ./scripts/reset-project.js",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web",
    "lint": "expo lint"
  },
  "dependencies": {
    "@expo/metro-runtime": "6.1.2",
    "@expo/vector-icons": "15.1.1",
    "@react-native-async-storage/async-storage": "2.2.0",
    "date-fns": "4.1.0",
    "dayjs": "1.11.13",
    "expo": "54.0.35",
    "expo-blur": "15.0.8",
    "expo-constants": "18.0.13",
    "expo-font": "14.0.12",
    "expo-haptics": "15.0.8",
    "expo-image": "3.0.11",
    "expo-linear-gradient": "15.0.8",
    "expo-linking": "8.0.12",
    "expo-router": "6.0.24",
    "expo-secure-store": "15.0.8",
    "expo-splash-screen": "31.0.13",
    "expo-status-bar": "3.0.9",
    "expo-symbols": "1.0.8",
    "expo-system-ui": "6.0.9",
    "expo-web-browser": "15.0.11",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "react-native": "0.81.5",
    "react-native-dotenv": "3.4.11",
    "react-native-gesture-handler": "2.28.0",
    "react-native-reanimated": "4.1.1",
    "react-native-safe-area-context": "5.6.0",
    "react-native-screens": "4.16.0",
    "react-native-web": "0.21.0",
    "react-native-webview": "13.15.0",
    "react-native-worklets": "0.5.1"
  },
  "devDependencies": {
    "@types/react": "19.1.10",
    "eslint": "9.25.0",
    "eslint-config-expo": "10.0.0",
    "expo-doctor": "1.19.8",
    "typescript": "5.9.3"
  },
  "resolutions": {
    "@eslint/plugin-kit": "0.3.4",
    "postcss": "8.5.10",
    "uuid": "11.1.1"
  },
  "private": true,
  "packageManager": "yarn@1.22.22+sha512.a6b2f7906b721bba3d67d4aff083df04dad64c399707841b7acf00f6b133b7ac24255f2652fa22ae3534329dc6180534e98d17432037ff6fd140556e2bb3137e"
}

```


## `frontend/app.json`

```json
{
  "expo": {
    "name": "frontend",
    "slug": "frontend",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "frontend",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.emergent.contractorplatform.xc586z"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon.png",
        "backgroundColor": "#000000"
      },
      "edgeToEdgeEnabled": true,
      "package": "com.emergent.contractorplatform.xc586z"
    },
    "web": {
      "bundler": "metro",
      "output": "single",
      "favicon": "./assets/images/favicon.png"
    },
    "plugins": [
      "expo-router",
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-image.png",
          "imageWidth": 200,
          "resizeMode": "contain",
          "backgroundColor": "#000000"
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true
    }
  }
}
```


## `frontend/src/theme.ts`

```typescript
export const theme = {
  colors: {
    bg: "#0F1419",
    surface: "#1A2129",
    surfaceAlt: "#232D38",
    border: "#2E3A47",
    primary: "#F97316", // construction orange
    primaryDark: "#C2410C",
    text: "#F1F5F9",
    textMuted: "#94A3B8",
    success: "#22C55E",
    warning: "#EAB308",
    danger: "#EF4444",
    info: "#3B82F6",
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 8, md: 12, lg: 16, xl: 24 },
};

export const statusColor: Record<string, string> = {
  NEW: "#3B82F6",
  CONTACTED: "#EAB308",
  QUALIFIED: "#8B5CF6",
  CONVERTED: "#22C55E",
  LOST: "#EF4444",
  DRAFT: "#94A3B8",
  SENT: "#3B82F6",
  ACCEPTED: "#22C55E",
  REJECTED: "#EF4444",
  EXPIRED: "#78716C",
  SCHEDULED: "#3B82F6",
  IN_PROGRESS: "#F97316",
  ON_HOLD: "#EAB308",
  COMPLETED: "#22C55E",
  INVOICED: "#8B5CF6",
  CANCELLED: "#EF4444",
};

```


## `frontend/src/api/client.ts`

```typescript
import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = "cos_token";

export async function getToken(): Promise<string | null> {
  return await storage.secureGet<string>(TOKEN_KEY, "");
}

export async function setToken(token: string) {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken() {
  await storage.secureRemove(TOKEN_KEY);
}

type Options = {
  method?: string;
  body?: any;
  auth?: boolean;
};

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = await getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.detail || "Request failed");
  }
  return data as T;
}

```


## `frontend/src/context/AuthContext.tsx`

```tsx
import React, { createContext, useContext, useEffect, useState } from "react";
import { api, setToken, clearToken, getToken } from "@/src/api/client";

type User = { id: string; name: string; email: string; role: string; company_id: string };
type Company = { id: string; name: string; abn?: string };

type AuthState = {
  user: User | null;
  company: Company | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (p: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
};

type RegisterPayload = {
  company_name: string;
  name: string;
  email: string;
  password: string;
  abn?: string;
};

const Ctx = createContext<AuthState>({} as AuthState);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (token) {
        try {
          const me = await api<{ user: User; company: Company }>("/auth/me");
          setUser(me.user);
          setCompany(me.company);
        } catch {
          await clearToken();
        }
      }
      setLoading(false);
    })();
  }, []);

  async function login(email: string, password: string) {
    const res = await api<{ token: string; user: User; company: Company }>("/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password },
    });
    await setToken(res.token);
    setUser(res.user);
    setCompany(res.company);
  }

  async function register(p: RegisterPayload) {
    const res = await api<{ token: string; user: User; company: Company }>("/auth/register", {
      method: "POST",
      auth: false,
      body: p,
    });
    await setToken(res.token);
    setUser(res.user);
    setCompany(res.company);
  }

  async function logout() {
    await clearToken();
    setUser(null);
    setCompany(null);
  }

  return (
    <Ctx.Provider value={{ user, company, loading, login, register, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);

```


## `frontend/src/components/ui.tsx`

```tsx
import React from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme, statusColor } from "@/src/theme";

export function StatusBadge({ status }: { status: string }) {
  const color = statusColor[status] || theme.colors.textMuted;
  return (
    <View style={[badge.wrap, { backgroundColor: color + "22", borderColor: color }]}>
      <Text style={[badge.text, { color }]}>{status.replace("_", " ")}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  wrap: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, alignSelf: "flex-start" },
  text: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
});

export function Loading() {
  return <View style={c.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
}

export function EmptyState({ icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <View style={c.center}>
      <Ionicons name={icon} size={44} color={theme.colors.border} />
      <Text style={c.emptyTitle}>{title}</Text>
      {!!subtitle && <Text style={c.emptySub}>{subtitle}</Text>}
    </View>
  );
}

export function Fab({ onPress, testID }: { onPress: () => void; testID?: string }) {
  return (
    <Pressable style={c.fab} onPress={onPress} testID={testID}>
      <Ionicons name="add" size={28} color="#fff" />
    </Pressable>
  );
}

export function money(n: number) {
  return "$" + (n || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const c = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.xl },
  emptyTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "700", marginTop: theme.spacing.md },
  emptySub: { color: theme.colors.textMuted, fontSize: 13, marginTop: 4, textAlign: "center" },
  fab: {
    position: "absolute", right: theme.spacing.md, bottom: theme.spacing.lg,
    width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primary,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
});

```


## `frontend/src/components/Estimator.tsx`

```tsx
import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Modal, ScrollView, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { money } from "@/src/components/ui";

type Line = {
  description: string; kind: string; unit: string; quantity: number;
  unit_rate: number; pricing_rate_id: string | null; line_total: number;
};

const TRADES: { key: string; label: string; icon: string; fields: { key: string; label: string; def?: string }[] }[] = [
  { key: "concrete_slab", label: "Concrete Slab", icon: "cube", fields: [
    { key: "area_m2", label: "Area (m²)" }, { key: "thickness_mm", label: "Thickness (mm)", def: "100" } ] },
  { key: "fencing", label: "Fencing", icon: "git-commit", fields: [
    { key: "length_m", label: "Length (m)" }, { key: "panel_width_m", label: "Panel width (m)", def: "2.4" } ] },
  { key: "retaining_wall", label: "Retaining Wall", icon: "layers", fields: [
    { key: "length_m", label: "Length (m)" }, { key: "height_m", label: "Height (m)", def: "1.0" } ] },
  { key: "turf", label: "Turf / Landscape", icon: "leaf", fields: [
    { key: "area_m2", label: "Area (m²)" } ] },
  { key: "earthworks", label: "Earthworks", icon: "car", fields: [
    { key: "area_m2", label: "Area (m²)" }, { key: "depth_m", label: "Depth (m)", def: "0.3" } ] },
];

export default function Estimator({ visible, onClose, onAdd }:
  { visible: boolean; onClose: () => void; onAdd: (lines: any[]) => void }) {
  const [trade, setTrade] = useState(TRADES[0]);
  const [params, setParams] = useState<Record<string, string>>({});
  const [items, setItems] = useState<Line[]>([]);
  const [assumptions, setAssumptions] = useState<any>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<any[]>([]);
  const [showSave, setShowSave] = useState(false);
  const [tplName, setTplName] = useState("");
  const [rateStr, setRateStr] = useState<Record<number, string>>({});

  useEffect(() => {
    if (visible) {
      api("/estimate-templates").then(setTemplates).catch(() => {});
    }
  }, [visible]);

  async function loadTemplates() {
    try { setTemplates(await api("/estimate-templates")); } catch {}
  }

  function applyTemplate(tpl: any) {
    const t = TRADES.find((x) => x.key === tpl.trade) || TRADES[0];
    setTrade(t);
    const p: Record<string, string> = {};
    Object.entries(tpl.params || {}).forEach(([k, v]) => { p[k] = String(v); });
    setParams(p); setItems([]); setAssumptions(null); setSelected({}); setError("");
  }

  async function saveTemplate() {
    if (!tplName.trim()) return;
    const num: Record<string, number> = {};
    Object.entries(params).forEach(([k, v]) => { num[k] = parseFloat(v) || 0; });
    await api("/estimate-templates", { method: "POST", body: { name: tplName.trim(), trade: trade.key, params: num } });
    setTplName(""); setShowSave(false); loadTemplates();
  }

  async function removeTemplate(id: string) {
    await api(`/estimate-templates/${id}`, { method: "DELETE" });
    loadTemplates();
  }

  function editRate(idx: number, val: string) {
    setRateStr((prev) => ({ ...prev, [idx]: val }));
    const r = parseFloat(val) || 0;
    setItems((prev) => prev.map((it, i) =>
      i === idx ? { ...it, unit_rate: r, line_total: Math.round(it.quantity * r * 100) / 100 } : it));
  }

  function pickTrade(t: typeof TRADES[0]) {
    setTrade(t);
    const init: Record<string, string> = {};
    t.fields.forEach((f) => { if (f.def) init[f.key] = f.def; });
    setParams(init); setItems([]); setAssumptions(null); setSelected({}); setError("");
  }

  async function compute() {
    setError(""); setBusy(true);
    try {
      const num: Record<string, number> = {};
      Object.entries(params).forEach(([k, v]) => { num[k] = parseFloat(v) || 0; });
      const res = await api<{ items: Line[]; assumptions: any }>("/estimate-materials", {
        method: "POST", body: { trade: trade.key, params: num },
      });
      setItems(res.items);
      setAssumptions(res.assumptions);
      const sel: Record<number, boolean> = {};
      const rs: Record<number, string> = {};
      res.items.forEach((it, i) => { sel[i] = true; rs[i] = String(it.unit_rate); });
      setSelected(sel);
      setRateStr(rs);
    } catch (e: any) {
      setError(e.message || "Could not estimate");
    } finally { setBusy(false); }
  }

  function addSelected() {
    const lines = items.filter((_, i) => selected[i]).map((it) => ({
      description: it.description, kind: it.kind, quantity: it.quantity,
      unit: it.unit, unit_rate: it.unit_rate, pricing_rate_id: it.pricing_rate_id,
    }));
    if (lines.length) onAdd(lines);
    onClose();
  }

  const total = items.reduce((a, it, i) => a + (selected[i] ? it.line_total : 0), 0);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Pressable onPress={onClose} testID="estimator-close"><Ionicons name="close" size={26} color={theme.colors.text} /></Pressable>
          <Text style={styles.title}>Quantity Estimator</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Trade</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
            {TRADES.map((t) => (
              <Pressable key={t.key} onPress={() => pickTrade(t)} style={[styles.tchip, trade.key === t.key && styles.tchipActive]} testID={`est-trade-${t.key}`}>
                <Ionicons name={t.icon as any} size={15} color={trade.key === t.key ? "#fff" : theme.colors.textMuted} />
                <Text style={[styles.tchipText, trade.key === t.key && { color: "#fff" }]}>{t.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.inputsRow}>
            {trade.fields.map((f) => (
              <View key={f.key} style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>{f.label}</Text>
                <TextInput style={styles.input} keyboardType="numeric" placeholder="0"
                  placeholderTextColor={theme.colors.textMuted}
                  value={params[f.key] ?? ""} onChangeText={(v) => setParams({ ...params, [f.key]: v })}
                  testID={`est-field-${f.key}`} />
              </View>
            ))}
          </View>

          <Pressable style={styles.calcBtn} onPress={compute} disabled={busy} testID="est-calculate-button">
            {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="calculator" size={18} color="#fff" /><Text style={styles.calcText}>Calculate Quantities</Text></>}
          </Pressable>
          {!!error && <Text style={styles.error} testID="est-error">{error}</Text>}

          {templates.length > 0 && (
            <>
              <Text style={styles.label}>Saved templates</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                {templates.map((tpl) => (
                  <Pressable key={tpl.id} onPress={() => applyTemplate(tpl)} onLongPress={() => removeTemplate(tpl.id)} style={styles.tplChip} testID={`est-tpl-${tpl.id}`}>
                    <Ionicons name="bookmark" size={13} color={theme.colors.primary} />
                    <Text style={styles.tplText}>{tpl.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={styles.hint}>Tap to load · long-press to delete</Text>
            </>
          )}

          {showSave ? (
            <View style={styles.saveRow}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Template name" placeholderTextColor={theme.colors.textMuted}
                value={tplName} onChangeText={setTplName} testID="est-tpl-name-input" autoFocus />
              <Pressable style={styles.saveTplBtn} onPress={saveTemplate} testID="est-tpl-save"><Ionicons name="checkmark" size={20} color="#fff" /></Pressable>
              <Pressable style={styles.saveTplCancel} onPress={() => setShowSave(false)}><Ionicons name="close" size={20} color={theme.colors.text} /></Pressable>
            </View>
          ) : (
            <Pressable style={styles.saveTplLink} onPress={() => setShowSave(true)} testID="est-save-template-button">
              <Ionicons name="bookmark-outline" size={15} color={theme.colors.primary} />
              <Text style={styles.addLineText}>Save current inputs as template</Text>
            </Pressable>
          )}

          {items.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Results — tap to include/exclude</Text>
              {items.map((it, i) => (
                <View key={i} style={[styles.line, selected[i] && styles.lineOn]} testID={`est-line-${i}`}>
                  <Pressable onPress={() => setSelected({ ...selected, [i]: !selected[i] })} testID={`est-line-toggle-${i}`}>
                    <Ionicons name={selected[i] ? "checkbox" : "square-outline"} size={20} color={selected[i] ? theme.colors.primary : theme.colors.textMuted} />
                  </Pressable>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.lineDesc}>{it.description}</Text>
                    <View style={styles.rateRow}>
                      <Text style={styles.lineMeta}>{it.quantity} {it.unit} @ $</Text>
                      <TextInput style={styles.rateInput} keyboardType="numeric" value={rateStr[i] ?? ""}
                        onChangeText={(v) => editRate(i, v)} testID={`est-rate-input-${i}`} />
                    </View>
                  </View>
                  <Text style={styles.lineTotal}>{money(it.line_total)}</Text>
                </View>
              ))}

              {assumptions && (
                <View style={styles.assume} testID="est-assumptions">
                  <Text style={styles.assumeTitle}>Assumptions used</Text>
                  {Object.entries(assumptions).map(([k, v]) => (
                    <Text key={k} style={styles.assumeText}>· {k.replace(/_/g, " ")}: {String(v)}</Text>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>

        {items.length > 0 && (
          <View style={styles.footer}>
            <View>
              <Text style={styles.footerLabel}>Selected total</Text>
              <Text style={styles.footerTotal}>{money(total)}</Text>
            </View>
            <Pressable style={styles.addBtn} onPress={addSelected} testID="est-add-button">
              <Text style={styles.addText}>Add to Quote</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg, paddingTop: Platform.OS === "ios" ? 44 : 24 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 17, fontWeight: "800" },
  label: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "700", marginBottom: 6, marginTop: 8 },
  tchip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, flexShrink: 0 },
  tchipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  tchipText: { color: theme.colors.textMuted, fontWeight: "700", fontSize: 13 },
  inputsRow: { flexDirection: "row", marginTop: 4 },
  input: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, height: 48, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border },
  calcBtn: { flexDirection: "row", gap: 8, backgroundColor: theme.colors.primary, height: 52, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.md },
  calcText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  error: { color: theme.colors.danger, fontSize: 13, marginTop: 8 },
  hint: { color: theme.colors.textMuted, fontSize: 11, marginTop: 4, fontStyle: "italic" },
  tplChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.primary, flexShrink: 0 },
  tplText: { color: theme.colors.text, fontWeight: "600", fontSize: 12 },
  saveRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: theme.spacing.md },
  saveTplBtn: { width: 48, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center" },
  saveTplCancel: { width: 48, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  saveTplLink: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: theme.spacing.md },
  addLineText: { color: theme.colors.primary, fontWeight: "700", fontSize: 13 },
  rateRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  rateInput: { minWidth: 60, height: 30, backgroundColor: theme.colors.surfaceAlt, borderRadius: 6, paddingHorizontal: 8, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border, fontSize: 12, marginLeft: 2 },
  sectionTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700", marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  line: { flexDirection: "row", alignItems: "center", backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8, opacity: 0.55 },
  lineOn: { opacity: 1, borderColor: theme.colors.primary },
  lineDesc: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  lineMeta: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  lineTotal: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  assume: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, padding: theme.spacing.md, marginTop: 8 },
  assumeTitle: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "800", marginBottom: 6, textTransform: "uppercase" },
  assumeText: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  footer: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: theme.spacing.md, paddingBottom: theme.spacing.lg, backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border },
  footerLabel: { color: theme.colors.textMuted, fontSize: 12 },
  footerTotal: { color: theme.colors.primary, fontSize: 20, fontWeight: "800" },
  addBtn: { backgroundColor: theme.colors.primary, paddingHorizontal: theme.spacing.xl, height: 50, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center" },
  addText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});

```


## `frontend/app/_layout.tsx`

```tsx
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/context/AuthContext";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true)

// Keep the native splash visible from cold start until icon fonts register.
// Required because @expo/vector-icons' componentDidMount fallback fires
// Font.loadAsync against a broken vendor path if any <Icon> mounts before
// the family is registered — which throws on Android Expo Go.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  // If the CDN is unreachable we fall through on error rather than wedging
  // the app — icons will tofu, but the app still boots.
  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0F1419" } }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

```


## `frontend/app/index.tsx`

```tsx
import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { theme } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) router.replace("/(tabs)");
      else router.replace("/login");
    }
  }, [loading, user]);

  return (
    <View style={styles.container} testID="splash-loading">
      <ActivityIndicator size="large" color={theme.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg, alignItems: "center", justifyContent: "center" },
});

```


## `frontend/app/login.tsx`

```tsx
import { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/context/AuthContext";
import { theme } from "@/src/theme";

export default function Login() {
  const { login, register } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [abn, setAbn] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register({ company_name: company.trim(), name: name.trim(), email: email.trim(), password, abn: abn.trim() });
      }
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.bg }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.logoWrap}>
          <View style={styles.logoBox}><Ionicons name="construct" size={32} color="#fff" /></View>
          <Text style={styles.brand}>CONTRACTOR OS</Text>
          <Text style={styles.tagline}>Field & office management for Victorian trades</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>{mode === "login" ? "Welcome back" : "Create your account"}</Text>

          {mode === "register" && (
            <>
              <Field label="Company name" value={company} onChange={setCompany} placeholder="ACME Concreting" testID="reg-company-input" />
              <Field label="Your name" value={name} onChange={setName} placeholder="Jane Smith" testID="reg-name-input" />
              <Field label="ABN (optional)" value={abn} onChange={setAbn} placeholder="12 345 678 901" testID="reg-abn-input" />
            </>
          )}
          <Field label="Email" value={email} onChange={setEmail} placeholder="you@company.com.au" keyboardType="email-address" testID="email-input" />
          <Field label="Password" value={password} onChange={setPassword} placeholder="••••••••" secure testID="password-input" />

          {!!error && <Text style={styles.error} testID="auth-error">{error}</Text>}

          <Pressable style={styles.btn} onPress={submit} disabled={busy} testID="auth-submit-button">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{mode === "login" ? "Sign In" : "Create Account"}</Text>}
          </Pressable>

          <Pressable onPress={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} testID="toggle-mode-button" style={styles.toggle}>
            <Text style={styles.toggleText}>
              {mode === "login" ? "New here? Create a company account" : "Already have an account? Sign in"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChange, placeholder, secure, keyboardType, testID }: any) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        secureTextEntry={secure}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
        keyboardType={keyboardType}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: theme.spacing.lg, flexGrow: 1 },
  logoWrap: { alignItems: "center", marginBottom: theme.spacing.xl },
  logoBox: { width: 64, height: 64, borderRadius: theme.radius.lg, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.md },
  brand: { color: theme.colors.text, fontSize: 22, fontWeight: "800", letterSpacing: 1 },
  tagline: { color: theme.colors.textMuted, fontSize: 13, marginTop: 4, textAlign: "center" },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: "700", marginBottom: theme.spacing.md },
  fieldWrap: { marginBottom: theme.spacing.md },
  label: { color: theme.colors.textMuted, fontSize: 12, marginBottom: 6, fontWeight: "600" },
  input: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, height: 48, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border },
  btn: { backgroundColor: theme.colors.primary, height: 52, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.sm },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  toggle: { marginTop: theme.spacing.md, alignItems: "center" },
  toggleText: { color: theme.colors.primary, fontSize: 13, fontWeight: "600" },
  error: { color: theme.colors.danger, fontSize: 13, marginBottom: theme.spacing.sm },
});

```


## `frontend/app/(tabs)/_layout.tsx`

```tsx
import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { useAuth } from "@/src/context/AuthContext";

export default function TabsLayout() {
  const { user, loading } = useAuth();
  if (!loading && !user) return <Redirect href="/login" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Dashboard", tabBarIcon: ({ color, size }) => <Ionicons name="grid" color={color} size={size} /> }} />
      <Tabs.Screen name="crm" options={{ title: "CRM", tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} /> }} />
      <Tabs.Screen name="quotes" options={{ title: "Quotes", tabBarIcon: ({ color, size }) => <Ionicons name="document-text" color={color} size={size} /> }} />
      <Tabs.Screen name="jobs" options={{ title: "Jobs", tabBarIcon: ({ color, size }) => <Ionicons name="hammer" color={color} size={size} /> }} />
    </Tabs>
  );
}

```


## `frontend/app/(tabs)/index.tsx`

```tsx
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/context/AuthContext";
import { theme } from "@/src/theme";
import { money } from "@/src/components/ui";

type Stats = {
  open_leads: number; customers: number; draft_quotes: number;
  accepted_quotes: number; active_jobs: number; completed_jobs: number; pipeline_value: number;
};

export default function Dashboard() {
  const { user, company, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<Stats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setStats(await api<Stats>("/dashboard/stats")); } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  const cards = [
    { label: "Open Leads", value: stats?.open_leads ?? 0, icon: "flame", color: "#F97316" },
    { label: "Customers", value: stats?.customers ?? 0, icon: "people", color: "#3B82F6" },
    { label: "Draft Quotes", value: stats?.draft_quotes ?? 0, icon: "document-text", color: "#94A3B8" },
    { label: "Accepted", value: stats?.accepted_quotes ?? 0, icon: "checkmark-circle", color: "#22C55E" },
    { label: "Active Jobs", value: stats?.active_jobs ?? 0, icon: "hammer", color: "#EAB308" },
    { label: "Completed", value: stats?.completed_jobs ?? 0, icon: "trophy", color: "#8B5CF6" },
  ];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={styles.hello}>Hi, {user?.name?.split(" ")[0]}</Text>
          <Text style={styles.company}>{company?.name} · {user?.role}</Text>
        </View>
        <Pressable onPress={logout} style={styles.logout} testID="logout-button">
          <Ionicons name="log-out-outline" size={22} color={theme.colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}>
        <View style={styles.pipeline} testID="pipeline-card">
          <Text style={styles.pipelineLabel}>Pipeline Value (sent + accepted)</Text>
          <Text style={styles.pipelineValue}>{money(stats?.pipeline_value ?? 0)}</Text>
        </View>

        <View style={styles.grid}>
          {cards.map((c) => (
            <View key={c.label} style={styles.statCard} testID={`stat-${c.label}`}>
              <View style={[styles.iconWrap, { backgroundColor: c.color + "22" }]}>
                <Ionicons name={c.icon as any} size={20} color={c.color} />
              </View>
              <Text style={styles.statValue}>{c.value}</Text>
              <Text style={styles.statLabel}>{c.label}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.section}>Workflow</Text>
        <View style={styles.flow}>
          {["Lead", "Quote", "Accepted", "Job", "Invoice"].map((s, i) => (
            <View key={s} style={styles.flowRow}>
              <View style={styles.flowDot}><Text style={styles.flowNum}>{i + 1}</Text></View>
              <Text style={styles.flowText}>{s}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  hello: { color: theme.colors.text, fontSize: 20, fontWeight: "800" },
  company: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
  logout: { padding: 8 },
  pipeline: { backgroundColor: theme.colors.primary, borderRadius: theme.radius.lg, padding: theme.spacing.lg, marginBottom: theme.spacing.md },
  pipelineLabel: { color: "#fff", opacity: 0.9, fontSize: 13, fontWeight: "600" },
  pipelineValue: { color: "#fff", fontSize: 30, fontWeight: "800", marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  statCard: { width: "31.5%", backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.sm },
  statValue: { color: theme.colors.text, fontSize: 22, fontWeight: "800" },
  statLabel: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  section: { color: theme.colors.text, fontSize: 16, fontWeight: "700", marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  flow: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border },
  flowRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  flowDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.primary + "22", alignItems: "center", justifyContent: "center", marginRight: theme.spacing.md },
  flowNum: { color: theme.colors.primary, fontWeight: "800", fontSize: 13 },
  flowText: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
});

```


## `frontend/app/(tabs)/crm.tsx`

```tsx
import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput,
  KeyboardAvoidingView, Platform, FlatList, RefreshControl,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { StatusBadge, EmptyState, Fab, money } from "@/src/components/ui";

const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"];

export default function CRM() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"leads" | "customers">("leads");
  const [leads, setLeads] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<any>({ title: "", contact_name: "", contact_phone: "", trade: "", estimated_value: "" });
  const [custForm, setCustForm] = useState<any>({ name: "", phone: "", email: "", suburb: "" });

  const load = useCallback(async () => {
    try {
      const [l, c] = await Promise.all([api("/leads"), api("/customers")]);
      setLeads(l); setCustomers(c);
    } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  async function cycleStatus(lead: any) {
    const idx = LEAD_STATUSES.indexOf(lead.status);
    const next = LEAD_STATUSES[(idx + 1) % 4]; // cycle NEW->CONTACTED->QUALIFIED->CONVERTED
    await api(`/leads/${lead.id}/status`, { method: "PATCH", body: { status: next } });
    load();
  }

  async function convert(lead: any) {
    await api(`/leads/${lead.id}/convert`, { method: "POST" });
    load();
  }

  async function save() {
    if (tab === "leads") {
      if (!form.title.trim()) return;
      await api("/leads", { method: "POST", body: { ...form, estimated_value: parseFloat(form.estimated_value) || 0 } });
      setForm({ title: "", contact_name: "", contact_phone: "", trade: "", estimated_value: "" });
    } else {
      if (!custForm.name.trim()) return;
      await api("/customers", { method: "POST", body: custForm });
      setCustForm({ name: "", phone: "", email: "", suburb: "" });
    }
    setModal(false);
    load();
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>CRM</Text>
        <View style={styles.segment}>
          {(["leads", "customers"] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.segBtn, tab === t && styles.segActive]} testID={`crm-tab-${t}`}>
              <Text style={[styles.segText, tab === t && styles.segTextActive]}>{t === "leads" ? "Leads" : "Customers"}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {tab === "leads" ? (
        <FlatList
          data={leads}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 90 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
          ListEmptyComponent={<EmptyState icon="flame-outline" title="No leads yet" subtitle="Tap + to add your first lead" />}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`lead-${item.id}`}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <StatusBadge status={item.status} />
              </View>
              {!!item.contact_name && <Text style={styles.cardSub}>{item.contact_name} · {item.contact_phone || "no phone"}</Text>}
              <Text style={styles.cardMeta}>{item.trade || "General"} · Est. {money(item.estimated_value || 0)}</Text>
              {item.status !== "CONVERTED" && item.status !== "LOST" && (
                <View style={styles.actions}>
                  <Pressable style={styles.actBtn} onPress={() => cycleStatus(item)} testID={`lead-advance-${item.id}`}>
                    <Ionicons name="arrow-forward-circle" size={16} color={theme.colors.info} />
                    <Text style={styles.actText}>Advance</Text>
                  </Pressable>
                  <Pressable style={styles.actBtn} onPress={() => convert(item)} testID={`lead-convert-${item.id}`}>
                    <Ionicons name="person-add" size={16} color={theme.colors.success} />
                    <Text style={[styles.actText, { color: theme.colors.success }]}>Convert</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
        />
      ) : (
        <FlatList
          data={customers}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 90 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
          ListEmptyComponent={<EmptyState icon="people-outline" title="No customers yet" />}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`customer-${item.id}`}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardSub}>{item.phone || "no phone"} · {item.email || "no email"}</Text>
              {!!item.suburb && <Text style={styles.cardMeta}>{item.suburb}</Text>}
            </View>
          )}
        />
      )}

      <Fab onPress={() => setModal(true)} testID="crm-add-button" />

      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{tab === "leads" ? "New Lead" : "New Customer"}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {tab === "leads" ? (
                <>
                  <Input ph="Lead title *" v={form.title} on={(t: string) => setForm({ ...form, title: t })} testID="lead-title-input" />
                  <Input ph="Contact name" v={form.contact_name} on={(t: string) => setForm({ ...form, contact_name: t })} />
                  <Input ph="Contact phone" v={form.contact_phone} on={(t: string) => setForm({ ...form, contact_phone: t })} />
                  <Input ph="Trade (e.g. Concrete)" v={form.trade} on={(t: string) => setForm({ ...form, trade: t })} />
                  <Input ph="Estimated value" v={form.estimated_value} on={(t: string) => setForm({ ...form, estimated_value: t })} kb="numeric" />
                </>
              ) : (
                <>
                  <Input ph="Customer name *" v={custForm.name} on={(t: string) => setCustForm({ ...custForm, name: t })} testID="customer-name-input" />
                  <Input ph="Phone" v={custForm.phone} on={(t: string) => setCustForm({ ...custForm, phone: t })} />
                  <Input ph="Email" v={custForm.email} on={(t: string) => setCustForm({ ...custForm, email: t })} kb="email-address" />
                  <Input ph="Suburb" v={custForm.suburb} on={(t: string) => setCustForm({ ...custForm, suburb: t })} />
                </>
              )}
            </ScrollView>
            <View style={styles.sheetActions}>
              <Pressable style={styles.cancelBtn} onPress={() => setModal(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              <Pressable style={styles.saveBtn} onPress={save} testID="crm-save-button"><Text style={styles.saveText}>Save</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export function Input({ ph, v, on, kb, testID }: any) {
  return (
    <TextInput style={sInput.input} placeholder={ph} placeholderTextColor={theme.colors.textMuted}
      value={v} onChangeText={on} keyboardType={kb} autoCapitalize={kb === "email-address" ? "none" : "sentences"} testID={testID} />
  );
}
const sInput = StyleSheet.create({
  input: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, height: 48, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border, marginBottom: theme.spacing.sm },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: "800", marginBottom: theme.spacing.md },
  segment: { flexDirection: "row", backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: theme.radius.sm, alignItems: "center" },
  segActive: { backgroundColor: theme.colors.primary },
  segText: { color: theme.colors.textMuted, fontWeight: "700", fontSize: 13 },
  segTextActive: { color: "#fff" },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginBottom: theme.spacing.sm },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700", flex: 1, marginRight: 8 },
  cardSub: { color: theme.colors.textMuted, fontSize: 13, marginTop: 4 },
  cardMeta: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: "row", gap: theme.spacing.md, marginTop: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.spacing.sm },
  actBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  actText: { color: theme.colors.info, fontSize: 13, fontWeight: "600" },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, padding: theme.spacing.lg, maxHeight: "80%" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, alignSelf: "center", marginBottom: theme.spacing.md },
  sheetTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "800", marginBottom: theme.spacing.md },
  sheetActions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  cancelBtn: { flex: 1, height: 48, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surfaceAlt },
  cancelText: { color: theme.colors.text, fontWeight: "700" },
  saveBtn: { flex: 2, height: 48, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.primary },
  saveText: { color: "#fff", fontWeight: "700" },
});

```


## `frontend/app/(tabs)/quotes.tsx`

```tsx
import { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Modal, ScrollView, FlatList,
  RefreshControl, TextInput,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { StatusBadge, EmptyState, Fab, money } from "@/src/components/ui";
import Estimator from "@/src/components/Estimator";

const KIND_FOR_CATEGORY: Record<string, string> = {
  Materials: "material", Labour: "labour", Equipment: "equipment",
};
const QUOTE_NEXT: Record<string, string> = { DRAFT: "SENT", SENT: "ACCEPTED" };
const QUOTE_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"];

export default function Quotes() {
  const insets = useSafeAreaInsets();
  const [quotes, setQuotes] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [builder, setBuilder] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);

  // builder state
  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [overhead, setOverhead] = useState("10");
  const [profit, setProfit] = useState("15");
  const [contingency, setContingency] = useState("5");
  const [recommendation, setRecommendation] = useState("");
  const [rateModal, setRateModal] = useState(false);
  const [estimatorOpen, setEstimatorOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [q, c, r] = await Promise.all([api("/quotes"), api("/customers"), api("/pricing-rates")]);
      setQuotes(q); setCustomers(c); setRates(r);
    } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  const preview = useMemo(() => {
    const buckets: any = { materials: 0, labour: 0, equipment: 0, subcontractors: 0, delivery: 0, waste: 0 };
    const map: any = { material: "materials", labour: "labour", equipment: "equipment", subcontractor: "subcontractors", delivery: "delivery", waste: "waste" };
    items.forEach((it) => { buckets[map[it.kind] || "materials"] += it.quantity * it.unit_rate; });
    const direct = Object.values(buckets).reduce((a: number, b: any) => a + b, 0) as number;
    const cont = direct * (parseFloat(contingency) || 0) / 100;
    const base = direct + cont;
    const oh = base * (parseFloat(overhead) || 0) / 100;
    const sub = base + oh;
    const pr = sub * (parseFloat(profit) || 0) / 100;
    const preGst = sub + pr;
    const gst = preGst * 0.1;
    return { direct, cont, oh, pr, gst, total: preGst + gst };
  }, [items, overhead, profit, contingency]);

  function addRate(rate: any) {
    setItems([...items, {
      description: rate.description, kind: KIND_FOR_CATEGORY[rate.category] || "material",
      quantity: 1, unit: rate.unit, unit_rate: rate.rate, pricing_rate_id: rate.id,
    }]);
    setRateModal(false);
  }

  function updateQty(idx: number, qty: string) {
    const copy = [...items];
    copy[idx].quantity = parseFloat(qty) || 0;
    setItems(copy);
  }

  function resetBuilder() {
    setTitle(""); setCustomerId(null); setItems([]); setOverhead("10"); setProfit("15"); setContingency("5"); setEditingId(null); setRecommendation("");
  }

  async function recommendMargins() {
    if (items.length === 0) return;
    try {
      const res = await api<{ contingency: number; overhead: number; profit: number; rationale: string[] }>(
        "/recommend-margins", { method: "POST", body: { items } });
      setContingency(String(res.contingency));
      setOverhead(String(res.overhead));
      setProfit(String(res.profit));
      setRecommendation(res.rationale.join(" · "));
    } catch {}
  }

  function openEditor(quote: any) {
    setEditingId(quote.id);
    setTitle(quote.title || "");
    setCustomerId(quote.customer_id || null);
    setItems((quote.items || []).map((it: any) => ({
      description: it.description, kind: it.kind, quantity: it.quantity,
      unit: it.unit, unit_rate: it.unit_rate, pricing_rate_id: it.pricing_rate_id || null,
    })));
    setOverhead(String(quote.overhead_percentage ?? 10));
    setProfit(String(quote.profit_percentage ?? 15));
    setContingency(String(quote.contingency_percentage ?? 0));
    setDetail(null);
    setBuilder(true);
  }

  async function saveQuote() {
    if (!title.trim() || items.length === 0) return;
    const body = {
      title, customer_id: customerId, items,
      contingency_percentage: parseFloat(contingency) || 0,
      overhead_percentage: parseFloat(overhead) || 0,
      profit_percentage: parseFloat(profit) || 0,
    };
    if (editingId) {
      await api(`/quotes/${editingId}`, { method: "PUT", body });
    } else {
      await api("/quotes", { method: "POST", body });
    }
    resetBuilder(); setBuilder(false); load();
  }

  async function openDetail(id: string) {
    try {
      const d = await api(`/quotes/${id}`);
      setDetail(d);
    } catch {}
  }

  async function advance(q: any) {
    const next = QUOTE_NEXT[q.status];
    if (!next) return;
    await api(`/quotes/${q.id}/status`, { method: "PATCH", body: { status: next } });
    if (detail?.id === q.id) await openDetail(q.id);
    load();
  }

  async function toJob(q: any) {
    try {
      await api(`/quotes/${q.id}/convert-to-job`, { method: "POST" });
      setDetail(null);
      load();
    } catch {}
  }

  async function setQuoteStatus(q: any, status: string) {
    if (q.status === status) return;
    await api(`/quotes/${q.id}/status`, { method: "PATCH", body: { status } });
    if (detail?.id === q.id) await openDetail(q.id);
    load();
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>Quotes</Text>
      </View>

      <FlatList
        data={quotes}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 90 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
        ListEmptyComponent={<EmptyState icon="document-text-outline" title="No quotes yet" subtitle="Tap + to build a quote with live Victoria rates" />}
        renderItem={({ item }) => (
          <View style={styles.card} testID={`quote-${item.id}`}>
            <Pressable onPress={() => openDetail(item.id)} testID={`quote-open-${item.id}`}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.qnum}>{item.quote_number}</Text>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                </View>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.total}>{money(item.breakdown?.final_total || 0)}</Text>
              <Text style={styles.cardMeta}>Direct {money(item.breakdown?.direct_cost || 0)} · GST {money(item.breakdown?.gst || 0)} · v{item.version} · tap to view</Text>
            </Pressable>
            <View style={styles.actions}>
              {QUOTE_NEXT[item.status] && (
                <Pressable style={styles.actBtn} onPress={() => advance(item)} testID={`quote-advance-${item.id}`}>
                  <Ionicons name="send" size={15} color={theme.colors.info} />
                  <Text style={styles.actText}>Mark {QUOTE_NEXT[item.status]}</Text>
                </Pressable>
              )}
              {item.status === "ACCEPTED" && (
                <Pressable style={styles.actBtn} onPress={() => toJob(item)} testID={`quote-tojob-${item.id}`}>
                  <Ionicons name="hammer" size={15} color={theme.colors.success} />
                  <Text style={[styles.actText, { color: theme.colors.success }]}>Convert to Job</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      />

      <Fab onPress={() => { resetBuilder(); setBuilder(true); }} testID="quote-add-button" />

      {/* Quote builder */}
      <Modal visible={builder} animationType="slide" onRequestClose={() => { resetBuilder(); setBuilder(false); }}>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.builderHeader}>
            <Pressable onPress={() => { resetBuilder(); setBuilder(false); }} testID="builder-close"><Ionicons name="close" size={26} color={theme.colors.text} /></Pressable>
            <Text style={styles.builderTitle}>{editingId ? "Edit Quote" : "Quote Builder"}</Text>
            <Pressable onPress={saveQuote} testID="builder-save"><Text style={styles.saveLink}>Save</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <TextInput style={styles.input} placeholder="Quote title *" placeholderTextColor={theme.colors.textMuted} value={title} onChangeText={setTitle} testID="quote-title-input" />

            <Text style={styles.label}>Customer</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {customers.map((c) => (
                <Pressable key={c.id} onPress={() => setCustomerId(c.id)} style={[styles.chip, customerId === c.id && styles.chipActive]}>
                  <Text style={[styles.chipText, customerId === c.id && styles.chipTextActive]}>{c.name}</Text>
                </Pressable>
              ))}
              {customers.length === 0 && <Text style={styles.cardMeta}>Add customers in CRM first (optional)</Text>}
            </ScrollView>

            <View style={styles.rowBetween}>
              <Text style={styles.label}>Line items</Text>
              <View style={{ flexDirection: "row", gap: theme.spacing.md }}>
                <Pressable style={styles.addLine} onPress={() => setEstimatorOpen(true)} testID="estimate-button">
                  <Ionicons name="calculator" size={16} color={theme.colors.primary} />
                  <Text style={styles.addLineText}>Estimate qty</Text>
                </Pressable>
                <Pressable style={styles.addLine} onPress={() => setRateModal(true)} testID="add-line-button">
                  <Ionicons name="add" size={16} color={theme.colors.primary} />
                  <Text style={styles.addLineText}>Add rate</Text>
                </Pressable>
              </View>
            </View>

            {items.map((it, idx) => (
              <View key={idx} style={styles.lineItem} testID={`line-item-${idx}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineDesc}>{it.description}</Text>
                  <Text style={styles.lineMeta}>{money(it.unit_rate)}/{it.unit} · {it.kind}</Text>
                </View>
                <TextInput style={styles.qtyInput} value={String(it.quantity)} onChangeText={(t) => updateQty(idx, t)} keyboardType="numeric" testID={`qty-input-${idx}`} />
                <Text style={styles.lineTotal}>{money(it.quantity * it.unit_rate)}</Text>
                <Pressable onPress={() => setItems(items.filter((_, i) => i !== idx))}><Ionicons name="trash" size={18} color={theme.colors.danger} /></Pressable>
              </View>
            ))}

            <View style={styles.rowBetween}>
              <Text style={styles.label}>Margins</Text>
              <Pressable style={styles.addLine} onPress={recommendMargins} testID="recommend-margins-button">
                <Ionicons name="sparkles" size={16} color={theme.colors.primary} />
                <Text style={styles.addLineText}>Recommend %</Text>
              </Pressable>
            </View>
            {!!recommendation && (
              <View style={styles.recommendBox} testID="recommendation-text">
                <Ionicons name="bulb" size={14} color={theme.colors.warning} />
                <Text style={styles.recommendText}>{recommendation}</Text>
              </View>
            )}
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>Contingency %</Text>
                <TextInput style={styles.input} value={contingency} onChangeText={setContingency} keyboardType="numeric" testID="contingency-input" />
              </View>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>Overhead %</Text>
                <TextInput style={styles.input} value={overhead} onChangeText={setOverhead} keyboardType="numeric" testID="overhead-input" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Profit %</Text>
                <TextInput style={styles.input} value={profit} onChangeText={setProfit} keyboardType="numeric" testID="profit-input" />
              </View>
            </View>

            <View style={styles.breakdown} testID="quote-breakdown">
              <Row l="Direct Costs" v={money(preview.direct)} />
              <Row l={`Contingency (${contingency}%)`} v={money(preview.cont)} />
              <Row l={`Overheads (${overhead}%)`} v={money(preview.oh)} />
              <Row l={`Profit (${profit}%)`} v={money(preview.pr)} />
              <Row l="GST (10%)" v={money(preview.gst)} />
              <View style={styles.divider} />
              <Row l="Final Total" v={money(preview.total)} bold />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Rate picker */}
      <Modal visible={rateModal} animationType="slide" transparent onRequestClose={() => setRateModal(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Victoria Pricing Rates</Text>
            <FlatList
              data={rates}
              keyExtractor={(i) => i.id}
              renderItem={({ item }) => (
                <Pressable style={styles.rateRow} onPress={() => addRate(item)} testID={`rate-${item.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rateDesc}>{item.description}</Text>
                    <Text style={styles.lineMeta}>{item.trade} · {item.category}</Text>
                  </View>
                  <Text style={styles.ratePrice}>{money(item.rate)}/{item.unit}</Text>
                </Pressable>
              )}
            />
            <Pressable style={styles.cancelBtn} onPress={() => setRateModal(false)}><Text style={styles.cancelText}>Close</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Estimator
        visible={estimatorOpen}
        onClose={() => setEstimatorOpen(false)}
        onAdd={(lines) => setItems((prev) => [...prev, ...lines])}
      />

      {/* Quote detail viewer */}
      <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.builderHeader}>
            <Pressable onPress={() => setDetail(null)} testID="quote-detail-close"><Ionicons name="close" size={26} color={theme.colors.text} /></Pressable>
            <Text style={styles.builderTitle}>{detail?.quote_number}</Text>
            <View style={{ width: 26 }} />
          </View>
          {detail && (
            <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }} testID="quote-detail-view">
              <View style={styles.rowBetween}>
                <Text style={[styles.cardTitle, { fontSize: 18, flex: 1, marginRight: 8 }]}>{detail.title}</Text>
                <StatusBadge status={detail.status} />
              </View>
              <Text style={styles.total}>{money(detail.breakdown?.final_total || 0)}</Text>

              <Text style={[styles.label, { marginTop: theme.spacing.md }]}>Line items ({detail.items?.length || 0})</Text>
              {(detail.items || []).map((it: any, idx: number) => (
                <View key={idx} style={styles.lineItem} testID={`detail-item-${idx}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineDesc}>{it.description}</Text>
                    <Text style={styles.lineMeta}>{it.quantity} {it.unit} @ {money(it.unit_rate)} · {it.kind}</Text>
                  </View>
                  <Text style={styles.lineTotal}>{money(it.line_total || it.quantity * it.unit_rate)}</Text>
                </View>
              ))}

              <View style={styles.breakdown}>
                <Row l="Direct Costs" v={money(detail.breakdown?.direct_cost || 0)} />
                <Row l={`Contingency (${detail.contingency_percentage ?? 0}%)`} v={money(detail.breakdown?.contingency || 0)} />
                <Row l={`Overheads (${detail.overhead_percentage}%)`} v={money(detail.breakdown?.overheads || 0)} />
                <Row l={`Profit (${detail.profit_percentage}%)`} v={money(detail.breakdown?.profit || 0)} />
                <Row l="GST (10%)" v={money(detail.breakdown?.gst || 0)} />
                <View style={styles.divider} />
                <Row l="Final Total" v={money(detail.breakdown?.final_total || 0)} bold />
              </View>

              {detail.valid_until && (
                <Text style={styles.cardMeta}>Valid until {new Date(detail.valid_until).toLocaleDateString("en-AU")}</Text>
              )}

              {(detail.versions?.length || 0) > 0 && (
                <>
                  <Text style={[styles.label, { marginTop: theme.spacing.md }]}>Version history</Text>
                  {detail.versions.map((v: any) => (
                    <View key={v.id} style={styles.versionRow}>
                      <Text style={styles.lineDesc}>v{v.version}</Text>
                      <Text style={styles.lineMeta}>{money(v.breakdown?.final_total || 0)}</Text>
                    </View>
                  ))}
                </>
              )}

              <Text style={[styles.label, { marginTop: theme.spacing.md }]}>Adjust status</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                {QUOTE_STATUSES.map((s) => (
                  <Pressable key={s} onPress={() => setQuoteStatus(detail, s)} style={[styles.chip, detail.status === s && styles.chipActive]} testID={`detail-status-${s}`}>
                    <Text style={[styles.chipText, detail.status === s && styles.chipTextActive]}>{s}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
                {(detail.status === "DRAFT" || detail.status === "SENT") && (
                  <Pressable style={styles.detailAction} onPress={() => openEditor(detail)} testID="detail-edit">
                    <Ionicons name="create" size={16} color="#fff" />
                    <Text style={styles.detailActionText}>Edit Quote (adjust items & margins)</Text>
                  </Pressable>
                )}
                {detail.status === "ACCEPTED" && (
                  <Pressable style={[styles.detailAction, { backgroundColor: theme.colors.success }]} onPress={() => toJob(detail)} testID="detail-tojob">
                    <Ionicons name="hammer" size={16} color="#fff" />
                    <Text style={styles.detailActionText}>Convert to Job</Text>
                  </Pressable>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

function Row({ l, v, bold }: any) {
  return (
    <View style={styles.brow}>
      <Text style={[styles.blabel, bold && { color: theme.colors.text, fontWeight: "800", fontSize: 16 }]}>{l}</Text>
      <Text style={[styles.bval, bold && { fontSize: 18, color: theme.colors.primary }]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: "800" },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginBottom: theme.spacing.sm },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  qnum: { color: theme.colors.textMuted, fontSize: 11, fontWeight: "700" },
  cardTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700", marginTop: 2 },
  total: { color: theme.colors.primary, fontSize: 22, fontWeight: "800", marginTop: 6 },
  cardMeta: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: "row", gap: theme.spacing.lg, marginTop: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.spacing.sm },
  actBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  actText: { color: theme.colors.info, fontSize: 13, fontWeight: "600" },
  builderHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  builderTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "800" },
  saveLink: { color: theme.colors.primary, fontSize: 16, fontWeight: "700" },
  input: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, height: 48, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border, marginBottom: theme.spacing.sm },
  label: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "700", marginBottom: 6, marginTop: 6 },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { color: theme.colors.textMuted, fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: "#fff" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  addLine: { flexDirection: "row", alignItems: "center", gap: 2 },
  addLineText: { color: theme.colors.primary, fontWeight: "700", fontSize: 13 },
  lineItem: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 6 },
  lineDesc: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  lineMeta: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  qtyInput: { width: 52, height: 38, backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, textAlign: "center", color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border },
  lineTotal: { color: theme.colors.text, fontSize: 13, fontWeight: "700", width: 78, textAlign: "right" },
  breakdown: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginTop: theme.spacing.md },
  brow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  blabel: { color: theme.colors.textMuted, fontSize: 14 },
  bval: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 6 },
  recommendBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.colors.warning + "18", borderRadius: theme.radius.sm, padding: theme.spacing.sm, marginBottom: theme.spacing.sm },
  recommendText: { color: theme.colors.text, fontSize: 12, flex: 1 },
  versionRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 6 },
  detailAction: { flexDirection: "row", gap: 8, backgroundColor: theme.colors.primary, height: 50, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center" },
  detailActionText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, padding: theme.spacing.lg, maxHeight: "80%" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, alignSelf: "center", marginBottom: theme.spacing.md },
  sheetTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "800", marginBottom: theme.spacing.md },
  rateRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  rateDesc: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  ratePrice: { color: theme.colors.primary, fontSize: 13, fontWeight: "700" },
  cancelBtn: { height: 48, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surfaceAlt, marginTop: theme.spacing.md },
  cancelText: { color: theme.colors.text, fontWeight: "700" },
});

```


## `frontend/app/(tabs)/jobs.tsx`

```tsx
import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, FlatList, RefreshControl, Modal,
  ScrollView, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { StatusBadge, EmptyState, money } from "@/src/components/ui";

const JOB_STATUSES = ["SCHEDULED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "INVOICED"];

export default function Jobs() {
  const insets = useSafeAreaInsets();
  const [jobs, setJobs] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try { setJobs(await api("/jobs")); } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  async function openDetail(id: string) {
    const d = await api(`/jobs/${id}`);
    setDetail(d);
  }

  async function setStatus(status: string) {
    if (!detail) return;
    const progress = status === "COMPLETED" ? 100 : detail.progress;
    await api(`/jobs/${detail.id}/progress`, { method: "PATCH", body: { status, progress } });
    await openDetail(detail.id); load();
  }

  async function setProgress(delta: number) {
    if (!detail) return;
    const p = Math.max(0, Math.min(100, (detail.progress || 0) + delta));
    await api(`/jobs/${detail.id}/progress`, { method: "PATCH", body: { progress: p } });
    await openDetail(detail.id); load();
  }

  async function addNote() {
    if (!detail || !note.trim()) return;
    await api(`/jobs/${detail.id}/notes`, { method: "POST", body: { body: note.trim() } });
    setNote("");
    await openDetail(detail.id);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>Jobs</Text>
        <Text style={styles.sub}>Created from accepted quotes</Text>
      </View>

      <FlatList
        data={jobs}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
        ListEmptyComponent={<EmptyState icon="hammer-outline" title="No jobs yet" subtitle="Accept a quote and convert it to a job" />}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => openDetail(item.id)} testID={`job-${item.id}`}>
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <StatusBadge status={item.status} />
            </View>
            {!!item.value && <Text style={styles.value}>{money(item.value)}</Text>}
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${item.progress || 0}%` }]} />
            </View>
            <Text style={styles.cardMeta}>{item.progress || 0}% complete</Text>
          </Pressable>
        )}
      />

      <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)}>
        <KeyboardAvoidingView style={[styles.container, { paddingTop: insets.top }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.dHeader}>
            <Pressable onPress={() => setDetail(null)} testID="job-detail-close"><Ionicons name="close" size={26} color={theme.colors.text} /></Pressable>
            <Text style={styles.dTitle} numberOfLines={1}>{detail?.title}</Text>
            <View style={{ width: 26 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {detail && (
              <>
                <View style={styles.detailCard}>
                  <View style={styles.rowBetween}>
                    <StatusBadge status={detail.status} />
                    {!!detail.value && <Text style={styles.value}>{money(detail.value)}</Text>}
                  </View>
                  <View style={[styles.progressBar, { marginTop: 12 }]}>
                    <View style={[styles.progressFill, { width: `${detail.progress || 0}%` }]} />
                  </View>
                  <View style={styles.progressControls}>
                    <Pressable style={styles.pBtn} onPress={() => setProgress(-10)} testID="progress-minus"><Ionicons name="remove" size={18} color={theme.colors.text} /></Pressable>
                    <Text style={styles.pText}>{detail.progress || 0}%</Text>
                    <Pressable style={styles.pBtn} onPress={() => setProgress(10)} testID="progress-plus"><Ionicons name="add" size={18} color={theme.colors.text} /></Pressable>
                  </View>
                </View>

                <Text style={styles.section}>Status</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {JOB_STATUSES.map((s) => (
                    <Pressable key={s} onPress={() => setStatus(s)} style={[styles.chip, detail.status === s && styles.chipActive]} testID={`job-status-${s}`}>
                      <Text style={[styles.chipText, detail.status === s && styles.chipTextActive]}>{s.replace("_", " ")}</Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <Text style={styles.section}>Notes ({detail.notes?.length || 0})</Text>
                <View style={styles.noteInputRow}>
                  <TextInput style={styles.noteInput} placeholder="Add a site note..." placeholderTextColor={theme.colors.textMuted} value={note} onChangeText={setNote} testID="job-note-input" />
                  <Pressable style={styles.noteBtn} onPress={addNote} testID="job-note-add"><Ionicons name="send" size={18} color="#fff" /></Pressable>
                </View>
                {(detail.notes || []).map((n: any) => (
                  <View key={n.id} style={styles.note}>
                    <Text style={styles.noteText}>{n.body}</Text>
                    <Text style={styles.noteTime}>{new Date(n.created_at).toLocaleString("en-AU")}</Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: "800" },
  sub: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginBottom: theme.spacing.sm },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700", flex: 1, marginRight: 8 },
  value: { color: theme.colors.primary, fontSize: 16, fontWeight: "800" },
  cardMeta: { color: theme.colors.textMuted, fontSize: 12, marginTop: 4 },
  progressBar: { height: 8, backgroundColor: theme.colors.surfaceAlt, borderRadius: 4, marginTop: 10, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: theme.colors.primary, borderRadius: 4 },
  dHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  dTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "800", flex: 1, textAlign: "center", marginHorizontal: 8 },
  detailCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressControls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing.lg, marginTop: theme.spacing.md },
  pBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.surfaceAlt, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border },
  pText: { color: theme.colors.text, fontSize: 18, fontWeight: "800", minWidth: 56, textAlign: "center" },
  section: { color: theme.colors.text, fontSize: 15, fontWeight: "700", marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { color: theme.colors.textMuted, fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: "#fff" },
  noteInputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  noteInput: { flex: 1, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, height: 48, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border },
  noteBtn: { width: 48, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center" },
  note: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, marginTop: theme.spacing.sm },
  noteText: { color: theme.colors.text, fontSize: 14 },
  noteTime: { color: theme.colors.textMuted, fontSize: 11, marginTop: 4 },
});

```

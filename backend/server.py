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
    overhead_percentage: float = 10.0
    profit_percentage: float = 15.0
    gst_rate: float = GST_RATE


class EstimateInput(BaseModel):
    trade: str  # concrete_slab | fencing | retaining_wall | turf | earthworks
    params: Dict[str, Any] = {}


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
    overheads = round(direct_cost * inp.overhead_percentage / 100.0, 2)
    subtotal = round(direct_cost + overheads, 2)
    profit = round(subtotal * inp.profit_percentage / 100.0, 2)
    pre_gst = round(subtotal + profit, 2)
    gst = round(pre_gst * inp.gst_rate / 100.0, 2)
    final_total = round(pre_gst + gst, 2)
    return {
        "direct_cost": direct_cost,
        "overheads": overheads,
        "profit": profit,
        "gst": gst,
        "pre_gst": pre_gst,
        "final_total": final_total,
    }


def quote_totals_from_items(items: List[dict], overhead_pct: float, profit_pct: float) -> Dict[str, Any]:
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
    breakdown = quote_totals_from_items(items, inp.overhead_percentage, inp.profit_percentage)
    data = {
        "quote_number": await next_quote_number(user["company_id"]),
        "customer_id": inp.customer_id, "lead_id": inp.lead_id, "title": inp.title,
        "items": items, "overhead_percentage": inp.overhead_percentage,
        "profit_percentage": inp.profit_percentage, "status": "DRAFT",
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
    breakdown = quote_totals_from_items(items, inp.overhead_percentage, inp.profit_percentage)
    data = {
        "customer_id": inp.customer_id, "title": inp.title, "items": items,
        "overhead_percentage": inp.overhead_percentage,
        "profit_percentage": inp.profit_percentage, "breakdown": breakdown,
        "version": existing["version"] + 1,
    }
    updated = await update_doc("quotes", qid, data, user)
    await _snapshot_version(updated, user)
    return updated


@api_router.post("/quotes/{qid}/calculate")
async def recalc_quote(qid: str, user: dict = Depends(get_current_user)):
    quote = await get_doc("quotes", qid, user)
    breakdown = quote_totals_from_items(
        quote["items"], quote["overhead_percentage"], quote["profit_percentage"])
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

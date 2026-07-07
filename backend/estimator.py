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
    concrete_m3 = area * (thickness_mm / 1000.0) * (1 + waste)
    sheets = math.ceil(area / coverage) if area > 0 and coverage > 0 else 0
    chairs = math.ceil(area * chairs_per_m2)
    assumptions = {
        "mesh_sheet_coverage_m2": coverage, "bar_chairs_per_m2": chairs_per_m2,
        "thickness_mm": thickness_mm, "waste_pct": _num(p, "waste_pct", 5),
    }
    items = [
        _line(f"Concrete slab supply & lay {int(thickness_mm)}mm", "material", "m2", area, "concrete slab"),
        _line("Reinforcing mesh SL72", "material", "sheet", sheets, "reinforcing mesh"),
        _line("Bar chairs (plastic 50mm)", "material", "unit", chairs, "bar chairs"),
        _line("Concrete supply (volume incl. waste)", "material", "m3", concrete_m3, "reinforced concrete footing"),
    ]
    return items, assumptions


def fencing(p: dict):
    length = _num(p, "length_m", 0)
    panel_w = _num(p, "panel_width_m", 2.4)
    bags_per_post = _num(p, "cement_bags_per_post", 2)
    panels = math.ceil(length / panel_w) if length > 0 and panel_w > 0 else 0
    posts = panels + 1 if panels > 0 else 0
    cement_bags = math.ceil(posts * bags_per_post)
    assumptions = {"panel_width_m": panel_w, "posts_rule": "panels + 1 (end post each side)",
                   "cement_bags_per_post": bags_per_post}
    items = [
        _line("Colorbond panel 2.4m x 1.8m", "material", "panel", panels, "colorbond panel"),
        _line("Fence post + concrete footing", "material", "unit", posts, "fence post"),
        _line("Cement bag 20kg (post footings)", "material", "bag", cement_bags, "cement bag"),
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
    bays = math.ceil(length / sleeper_len) if length > 0 and sleeper_len > 0 else 0
    courses = math.ceil(height / sleeper_h) if height > 0 and sleeper_h > 0 else 0
    sleepers = bays * courses
    posts_total = bays + 1 if bays > 0 else 0
    end_beams = 2 if posts_total >= 2 else posts_total
    h_beams = max(posts_total - 2, 0)
    cement_bags = math.ceil(posts_total * bags_per_post)
    assumptions = {
        "sleeper_length_m": sleeper_len, "sleeper_height_m": sleeper_h,
        "bays": bays, "courses": courses,
        "posts_rule": "bays + 1 (2 end beams, remainder H-beams)",
        "cement_bags_per_post": bags_per_post,
    }
    items = [
        _line("Concrete sleeper 2.0m x 200mm", "material", "unit", sleepers, "concrete sleeper 2"),
        _line("Galvanised H-beam post 1.5m", "material", "unit", h_beams, "h-beam post"),
        _line("Retaining wall end beam (C-section)", "material", "unit", end_beams, "end beam"),
        _line("Cement bag 20kg (post footings)", "material", "bag", cement_bags, "cement bag"),
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

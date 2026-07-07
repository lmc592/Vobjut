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
]

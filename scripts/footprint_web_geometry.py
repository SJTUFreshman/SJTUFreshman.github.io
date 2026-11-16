"""Compact display geometry; the full precision editorial atlas stays untouched.

Tolerances are in the original 6000/8000-pixel map coordinate system, not
latitude/longitude. Even at maximum UI zoom the runtime error is sub-pixel.
"""

from copy import deepcopy
from decimal import Decimal
from functools import lru_cache
import re

from shapely.geometry import LineString, Polygon

RUNTIME_TOLERANCE = 0.35
HIT_TOLERANCE = 4.8
REGION_KEYS = ("id", "name", "label", "title", "country", "province", "unit",
               "color", "visited", "center", "path", "boundary_path", "restricted")


def rings(path):
    for text in re.findall(r"M([^M]+)", path):
        values = [float(value) for value in re.findall(r"[-+]?(?:\d*\.)?\d+", text)]
        if len(values) >= 6:
            yield list(zip(values[::2], values[1::2]))


def coordinate(value, precision=1):
    return f"{value:.{precision}f}".rstrip("0").rstrip(".") if precision else str(round(value))


def source_coordinate(value):
    # Preserve the parsed coordinate without scientific notation: the SVG path
    # reader intentionally accepts only fixed-point numbers.
    text = format(Decimal(str(value)), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


@lru_cache(maxsize=2048)
def compact_path(path, tolerance=RUNTIME_TOLERANCE, precision=1):
    result = []
    for points in rings(path):
        # Simplify each closed ring independently: retain every island and hole,
        # including tiny ones, without a union that could change even-odd fill.
        original = points if points[0] == points[-1] else [*points, points[0]]
        polygon = Polygon(original)
        candidate_tolerance = tolerance
        for attempt in range(8):
            simplified = polygon.simplify(candidate_tolerance, preserve_topology=True)
            points = list(simplified.exterior.coords) if simplified.geom_type == "Polygon" and not simplified.is_empty else original
            rounded = [(round(x, precision), round(y, precision)) for x, y in points]
            output_precision = precision
            # Quantisation can turn a narrow, valid ring into a self-touching
            # outline, which is unsafe input for a compound SVG clip.
            # Keep enough source precision to preserve a valid polygon rather
            # than relying on simplify(preserve_topology=True) before rounding.
            while polygon.is_valid and not Polygon(rounded).is_valid and output_precision < 2:
                output_precision += 1
                rounded = [(round(x, output_precision), round(y, output_precision)) for x, y in points]
            # GEOS topology preservation can displace a ring farther than the
            # requested simplification tolerance. Bound the actual outline error.
            valid = not polygon.is_valid or Polygon(rounded).is_valid
            if valid and LineString(original).hausdorff_distance(LineString(rounded)) <= tolerance + 0.71 * 10 ** -precision:
                break
            candidate_tolerance /= 2
        else:
            points = original
            output_precision = None
            rounded = original
        if output_precision is None or len(set(rounded)) < 3:
            # Tiny islands must remain addressable; retain original precision.
            result.append("M" + "L".join(f"{source_coordinate(x)},{source_coordinate(y)}" for x, y in original) + "Z")
        else:
            result.append("M" + "L".join(f"{coordinate(x, output_precision)},{coordinate(y, output_precision)}" for x, y in rounded) + "Z")
    return "".join(result)


def compact_region(region):
    item = {key: deepcopy(region[key]) for key in REGION_KEYS if key in region}
    # Cultural views are already displayed as one dissolved area. Store that
    # outline once rather than sending both it and all former city seams.
    if item.get("boundary_path") and item.get("unit") == "cultural-region":
        item.pop("path", None)
    for key in ("path", "boundary_path"):
        if item.get(key):
            item[key] = compact_path(item[key])
    if item.get("country") == "PRK" or item.get("id") == "PRK":
        # Personal atlas status, not a statement about legal travel restrictions.
        item["restricted"] = "closed"
    return item


def compact_map(metadata):
    result = deepcopy(metadata)
    for layer in [result, result.get("overview", {}), result.get("cultural", {})]:
        if "regions" in layer:
            layer["regions"] = [compact_region(region) for region in layer["regions"]]
        for route in layer.get("routes", []):
            if route.get("corridor_path"):
                route["corridor_path"] = compact_path(route["corridor_path"])
    result["insets"] = [compact_map(inset) for inset in result.get("insets", [])]
    return result


def hit_manifest(metadata):
    result = {"views": {}}
    for view in ("overview", "cultural", "detail"):
        layer = metadata if view == "detail" else metadata.get(view)
        if layer is None:
            continue
        items = []
        regions = layer.get("regions", [])
        if view == "detail":
            regions = [region for region in regions if region.get("visited")]
            # The closed-area treatment remains discoverable in either view.
            regions += [region for region in metadata.get("overview", {}).get("regions", [])
                        if region.get("country") == "PRK"]
        for region in regions:
            item = {key: deepcopy(region[key]) for key in REGION_KEYS
                    if key in region and key not in ("path", "boundary_path", "color")}
            path = region.get("boundary_path") or region.get("path")
            if not path:
                continue
            item["path"] = compact_path(path, HIT_TOLERANCE, precision=0)
            if item.get("country") == "PRK" or item.get("id") == "PRK":
                item["restricted"] = "closed"
            items.append(item)
        result["views"][view] = items
    return result

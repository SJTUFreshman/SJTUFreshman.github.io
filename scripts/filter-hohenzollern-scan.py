"""Trim the low, sealed scan shell from the Hohenzollern source study.

The downloaded model is a single watertight photogrammetry mesh.  Its lower
closure is useful for the source preview but reads as a dark rectangular slab
in wide views.  This filter keeps the upper island and the castle itself while
removing only low downward-facing faces and the outer low perimeter.  It is a
review-stage operation; it never mutates the licensed source package.
"""
import math

import bmesh


def _world_point(instance, point):
    return instance.matrix_world @ point


def _world_normal(instance, normal):
    return (instance.matrix_world.to_3x3() @ normal).normalized()


def _ellipse_radius(point, center_x, center_y, radius_x, radius_y):
    return math.sqrt(((point.x - center_x) / radius_x) ** 2
                     + ((point.y - center_y) / radius_y) ** 2)


def apply(objects, options=None):
    """Delete low scan-closure faces and return a deterministic audit report."""
    options = options or {}
    floor = float(options.get('floor_z', 3.5))
    shell_top = float(options.get('shell_top_z', 12.0))
    edge_limit = float(options.get('edge_ellipse_limit', 0.97))
    edge_top = float(options.get('edge_top_z', shell_top))
    downward_limit = float(options.get('downward_normal_z', -0.35))
    underside_limit = float(options.get('underside_ellipse_limit', 0.72))
    center_x = float(options.get('ellipse_center_x', -4.5))
    center_y = float(options.get('ellipse_center_y', -3.0))
    radius_x = float(options.get('ellipse_radius_x', 34.0))
    radius_y = float(options.get('ellipse_radius_y', 35.5))
    if floor >= shell_top:
        raise ValueError('floor_z must be below shell_top_z')
    if not (0 < edge_limit <= 1.5 and 0 < underside_limit <= edge_limit):
        raise ValueError('Invalid Hohenzollern ellipse limits')
    if min(radius_x, radius_y) <= 0:
        raise ValueError('Hohenzollern ellipse radii must be positive')

    mesh_objects = sorted((instance for instance in objects if instance.type == 'MESH'),
                          key=lambda instance: instance.name)
    if not mesh_objects:
        raise ValueError('Hohenzollern geometry filter received no mesh objects')
    reports = []
    total_removed = 0
    total_faces = 0
    for instance in mesh_objects:
        bm = bmesh.new()
        bm.from_mesh(instance.data)
        bm.faces.ensure_lookup_table()
        candidates = []
        reasons = {'below_floor': 0, 'outer_low_perimeter': 0, 'downward_closure': 0}
        for face in bm.faces:
            center = _world_point(instance, face.calc_center_median())
            normal = _world_normal(instance, face.normal)
            ellipse = _ellipse_radius(center, center_x, center_y, radius_x, radius_y)
            reason = None
            if center.z < floor:
                reason = 'below_floor'
            elif center.z < edge_top and ellipse > edge_limit:
                reason = 'outer_low_perimeter'
            elif (center.z < shell_top and normal.z < downward_limit
                  and ellipse > underside_limit):
                reason = 'downward_closure'
            if reason is not None:
                candidates.append(face)
                reasons[reason] += 1
        before = len(bm.faces)
        if candidates:
            bmesh.ops.delete(bm, geom=candidates, context='FACES')
            bm.to_mesh(instance.data)
            instance.data.update()
        bm.free()
        removed = len(candidates)
        total_removed += removed
        total_faces += before
        instance['review_geometry_filter'] = 'hohenzollern-low-shell-r3'
        instance['review_geometry_filter_removed_faces'] = removed
        reports.append({'object': instance.name, 'faces_before': before,
                        'faces_removed': removed, 'faces_after': before - removed,
                        'reasons': reasons})
    return {
        'id': 'hohenzollern-low-shell-r3',
        'method': 'low sealed shell trim using world-space floor, perimeter ellipse, and downward normals',
        'source_installation': False,
        'parameters': {'floor_z': floor, 'shell_top_z': shell_top,
                       'edge_top_z': edge_top, 'edge_ellipse_limit': edge_limit,
                       'downward_normal_z': downward_limit,
                       'underside_ellipse_limit': underside_limit,
                       'ellipse_center_xy': [center_x, center_y],
                       'ellipse_radii_xy': [radius_x, radius_y]},
        'faces_before': total_faces, 'faces_removed': total_removed,
        'faces_after': total_faces - total_removed, 'objects': reports,
        'limitations': [
            'Review-only geometric trim; no source package mutation',
            'The cut edge remains open and must be checked from all six directions',
            'Single diffuse texture and fused vegetation remain source limitations',
        ],
    }

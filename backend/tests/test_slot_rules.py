import pytest

from app.models import Location
from app.utils.slot_rules import validate_and_normalize_slot


def test_rack_row_only():
    loc = Location(id="l1", code="B-架", name="B架", type="货架", grid_rows=5)
    row, column = validate_and_normalize_slot(loc, 2, None)
    assert row == 2
    assert column is None


def test_rack_strips_extra_column():
    loc = Location(id="l1", code="B-架", name="B架", type="货架", grid_rows=5)
    row, column = validate_and_normalize_slot(loc, 2, 3)
    assert row == 2
    assert column is None


def test_cabinet_requires_both():
    loc = Location(id="l1", code="A-柜", name="A柜", type="货柜", grid_rows=4, grid_columns=6)
    with pytest.raises(ValueError, match="slot_incomplete"):
        validate_and_normalize_slot(loc, 2, None)


def test_cabinet_accepts_pair():
    loc = Location(id="l1", code="A-柜", name="A柜", type="货柜", grid_rows=4, grid_columns=6)
    row, column = validate_and_normalize_slot(loc, 2, 3)
    assert row == 2
    assert column == 3

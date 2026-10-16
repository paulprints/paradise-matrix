"""Research adapter: map a displayed bar to independently calculated levels.

Normal Paradise setting is displacement +1. The MNQ Daily benchmark chart
used 0. Source time and displayed time must remain separate. This module
does not fetch data, infer session completion, place orders, or enable parity.
"""
from research_candidates import calculate, availability, VERSION


def levels_for_display(bars, display_index, *, confirmed_through_index,
                       displacement=1):
    """Return 31 candidate levels from native-period OHLC records.

    bars maps absolute integer indices to OHLC strings and bar_time_local.
    Caller supplies the last confirmed complete source bar; never infer this
    from midnight or a fixed seconds/day/week/month offset. Missing input
    raises KeyError. An unconfirmed source is labeled developing. No price
    from an inactive or equality-sensitive line is exposed as active.
    """
    if type(displacement) is not int:
        raise TypeError('displacement must be an integer number of bars')
    if type(confirmed_through_index) is not int:
        raise TypeError('confirmed_through_index must be explicitly supplied')
    source_index = display_index - displacement
    values, margins = calculate(bars, source_index)
    source = bars[source_index]
    display = bars[display_index]  # Never invent a future calendar date.
    levels = {}
    for name, price in values.items():
        valid = availability(margins.get(name, []))
        levels[name] = {
            'state': 'boundary_sensitive' if valid is None else
                     'active' if valid else 'inactive',
            'value': str(price) if valid else None,
            'display_value': format(price, '.2f') if valid else None,
        }
    return {
        'hypothesis_version': VERSION,
        'production_eligible': False,
        'display_index': display_index,
        'display_bar_time': display['bar_time_local'],
        'source_index': source_index,
        'source_bar_time': source['bar_time_local'],
        'display_displacement_bars': displacement,
        'source_state': 'completed' if source_index <= confirmed_through_index
                        else 'developing',
        'levels': levels,
    }

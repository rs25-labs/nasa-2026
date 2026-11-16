"""Outward Decimal intervals for one-site geometry; no libm proof assumptions.

Inputs are exact integers/decimals or the exact value of a supplied binary
float. Each elementary operation rounds both endpoints out at 50 digits.
Trigonometric enclosures use 100 Taylor terms and an explicit remainder.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Context, Decimal, ROUND_CEILING, ROUND_FLOOR
from math import factorial

DOWN = Context(prec=50, rounding=ROUND_FLOOR)
UP = Context(prec=50, rounding=ROUND_CEILING)
PI_DIGITS = '3.14159265358979323846264338327950288419716939937510582097494459230781640628620899'


def decimal(value):
    return Decimal.from_float(value) if isinstance(value, float) else Decimal(value)


@dataclass(frozen=True)
class Interval:
    lo: Decimal
    hi: Decimal

    def __init__(self, lo, hi=None):
        object.__setattr__(self, 'lo', decimal(lo))
        object.__setattr__(self, 'hi', decimal(lo if hi is None else hi))
        if not self.lo.is_finite() or not self.hi.is_finite() or self.lo > self.hi:
            raise ValueError('Invalid finite interval')

    def __add__(self, other):
        other = interval(other)
        return Interval(DOWN.add(self.lo, other.lo), UP.add(self.hi, other.hi))

    __radd__ = __add__

    def __neg__(self):
        return Interval(self.hi.copy_negate(), self.lo.copy_negate())

    def __sub__(self, other):
        return self + -interval(other)

    def __rsub__(self, other):
        return interval(other) - self

    def __mul__(self, other):
        other = interval(other)
        pairs = [(a, b) for a in (self.lo, self.hi) for b in (other.lo, other.hi)]
        return Interval(min(DOWN.multiply(a, b) for a, b in pairs), max(UP.multiply(a, b) for a, b in pairs))

    __rmul__ = __mul__

    def __truediv__(self, other):
        other = interval(other)
        if other.lo <= 0 <= other.hi:
            raise ValueError('Division interval contains zero')
        pairs = [(a, b) for a in (self.lo, self.hi) for b in (other.lo, other.hi)]
        return Interval(min(DOWN.divide(a, b) for a, b in pairs), max(UP.divide(a, b) for a, b in pairs))

    def square(self):
        a, b = self.lo.copy_abs(), self.hi.copy_abs()
        low = Decimal(0) if self.lo <= 0 <= self.hi else DOWN.multiply(min(a, b), min(a, b))
        return Interval(low, UP.multiply(max(a, b), max(a, b)))

    def sqrt(self):
        if self.lo < 0:
            raise ValueError('Negative square-root interval')
        # Decimal.sqrt is correctly rounded to nearest even, regardless of
        # context rounding. Adjacent representable values enclose it.
        return Interval(max(Decimal(0), DOWN.next_minus(DOWN.sqrt(self.lo))), UP.next_plus(UP.sqrt(self.hi)))

    def nonnegative(self):
        """Intersect with [0,infinity) only for a known nonnegative quantity."""
        if self.hi < 0:
            raise ValueError('Nonnegative geometric quantity has negative upper bound')
        return Interval(max(Decimal(0), self.lo), self.hi)

    def midpoint_float(self):
        return float(DOWN.divide(DOWN.add(self.lo, self.hi), Decimal(2)))


def interval(value):
    return value if isinstance(value, Interval) else Interval(value)


PI = Interval(PI_DIGITS, UP.add(Decimal(PI_DIGITS), Decimal('1e-80')))


def sin_cos_degrees(degrees):
    """Enclose sine and cosine for an exact scalar angle in [-360,360]."""
    deg = interval(degrees)
    if deg.lo < -360 or deg.hi > 360:
        raise ValueError('Angle outside bounded trig domain')
    x = deg * PI / 180
    x2 = x.square()
    sine_term, cosine_term = x, Interval(1)
    sine, cosine = sine_term, cosine_term
    for n in range(1, 100):
        sine_term = -sine_term * x2 / ((2*n) * (2*n+1))
        cosine_term = -cosine_term * x2 / ((2*n-1) * (2*n))
        sine = sine + sine_term
        cosine = cosine + cosine_term
    # Lagrange remainder: degree 199 for sin, degree 198 for cos.
    # |x| <= 7 and every derivative has magnitude <= 1.
    sin_error = UP.divide(Decimal(7**200), Decimal(factorial(200)))
    cos_error = UP.divide(Decimal(7**199), Decimal(factorial(199)))
    return sine + Interval(sin_error.copy_negate(), sin_error), cosine + Interval(cos_error.copy_negate(), cos_error)


def dot(first, second):
    return sum((a*b for a, b in zip(first, second)), Interval(0))


def basis(latitude_deg, longitude_deg):
    slat, clat = sin_cos_degrees(latitude_deg)
    slon, clon = sin_cos_degrees(longitude_deg % 360)
    return ((-slon, clon, Interval(0)), (-slat*clon, -slat*slon, clat), (clat*clon, clat*slon, slat))

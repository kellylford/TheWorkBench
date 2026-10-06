"""Screen reader naming helpers (from Image Description Toolkit's chat app)."""
from __future__ import annotations

import wx


class _NamedAccessible(wx.Accessible):
    """Give a text control a name that reaches MSAA.

    childId 0 is the control itself; children (list items) defer to wx so a
    screen reader reads the item, not the control's label, on every arrow.
    """

    def __init__(self, window: wx.Window, label: str):
        super().__init__(window)
        self._label = label

    def set_label(self, label: str) -> None:
        self._label = label

    def GetName(self, childId):
        if childId:
            return (wx.ACC_NOT_IMPLEMENTED, None)
        return (wx.ACC_OK, self._label)


def set_accessible_name(control: wx.Window, label: str) -> None:
    """Name a control for JAWS and NVDA.

    ``SetName`` covers most controls. Text controls also get a wx.Accessible,
    because their name does not otherwise reach MSAA. Item-bearing controls
    (ListBox) deliberately do not: a custom accessible there risks masking
    the item text, which is the whole point of using a ListBox.
    """
    control.SetName(label)
    if not isinstance(control, wx.TextCtrl):
        return
    existing = getattr(control, "_hub_accessible", None)
    if existing is not None:
        existing.set_label(label)
        return
    try:
        accessible = _NamedAccessible(control, label)
        control.SetAccessible(accessible)
        control._hub_accessible = accessible  # keep it alive
    except (NotImplementedError, AttributeError):
        pass

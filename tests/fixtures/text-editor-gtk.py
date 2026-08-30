#!/usr/bin/env python3
import os
from pathlib import Path

import gi

gi.require_version("Gtk", "4.0")
from gi.repository import Gtk  # noqa: E402

INITIAL = "teh cat sat on teh mat"
OUTPUT = Path(os.environ["OMAPILOT_GTK_E2E_OUTPUT"])


class App(Gtk.Application):
    def do_activate(self):
        window = Gtk.ApplicationWindow(application=self, title="OmaPilot GTK text action lab")
        window.set_default_size(560, 240)
        editor = Gtk.TextView()
        editor.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        editor.set_monospace(True)
        editor.set_left_margin(24)
        editor.set_right_margin(24)
        editor.set_top_margin(24)
        editor.set_bottom_margin(24)
        buffer = editor.get_buffer()
        buffer.set_text(INITIAL)

        def persist(*_args):
            OUTPUT.write_text(buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), True))

        buffer.connect("changed", persist)
        persist()
        window.set_child(editor)
        window.present()
        editor.grab_focus()


App(application_id="io.github.spencerbull.omapilot.gtk_e2e").run(None)

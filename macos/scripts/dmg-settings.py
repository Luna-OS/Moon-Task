# dmgbuild settings for MoonTask's disk image: the night-sky background,
# the app on the left, Applications on the right.
# Used by scripts/bundle.sh: dmgbuild -s scripts/dmg-settings.py -D app=… -D background=… …
import os.path

app = defines["app"]  # noqa: F821 (provided by dmgbuild)
background = defines["background"]  # noqa: F821

format = "UDZO"
filesystem = "HFS+"
files = [app]
symlinks = {"Applications": "/Applications"}
icon_locations = {
    os.path.basename(app): (170, 190),
    "Applications": (490, 190),
}
window_rect = ((200, 140), (660, 400))
default_view = "icon-view"
icon_size = 112
text_size = 13
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
include_icon_view_settings = True

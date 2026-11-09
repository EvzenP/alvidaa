/* alvidaa native Home: the canvas launcher's design as a Vue component.
 *
 * This is the alvidaa variant in lane 3, not a second product. It reuses the
 * shared scaffold: native-entry.js does the route swap, native-platform.js
 * supplies apps and inputs through the vendor SDK, and native-home.cjs
 * installs and restores. Only the design lives here.
 *
 * Design, ported from launcher/index.html r4:
 *   - clock and date, top left
 *   - the inputs dock at the bottom edge, five tiles per page
 *   - the focused input's real name in large type above the dock, with a
 *     connected / no-signal line under it
 *   - one Apps tile that opens the app list as an overlay
 *   - a Settings tile that opens the real stock TV Settings
 *
 * Two views, panned vertically like the canvas: view 1 is the dock, view 2 is
 * the apps row. No canvas, no iframe, no network fetch, no global CSS.
 *
 * Unverified on hardware. Contracts come from the 55A7KAU and 75U8QTUK
 * findings; the platform adapter is the place where builds differ.
 */
(function (root) {
  "use strict";
  var DOCK_SIZE = 320, DOCK_HEIGHT = 176, DOCK_GAP = 24, DOCK_PAGE = 5;
  var OVERLAY_COLS = 5, OVERLAY_CELL = 192;

  function create(sdk) {
    var keys = sdk.key.KEYMAP;

    function p2(n) { return (n < 10 ? "0" : "") + n; }
    function hue(value) {
      var h = 0, text = String(value || "");
      for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
      return h;
    }
    function signalOf(input) {
      var value = input.is_signal != null ? input.is_signal : input.has_signal;
      return value === 1 || value === "1" || value === true;
    }
    function text(value) { return typeof value === "string" ? value.trim() : ""; }

    return {
      name: "Launcher", // The shared shell's keep-alive list uses this name.
      data: function () {
        return {
          apps: [], sources: [],
          zone: "dock", dock: 0, app: 0,
          overlay: false, overlayIndex: 0,
          now: new Date(), width: (root && root.innerWidth) || 1920,
          status: "Starting native services…"
        };
      },
      mounted: function () { this.start(); },
      activated: function () { this.start(); this.routeFocus(); },
      deactivated: function () { this.stop(); },
      beforeDestroy: function () { this.stop(); },
      watch: { "$route": function () { this.routeFocus(); } },
      methods: {
        start: function () {
          if (this._running) return;
          this._running = true;
          var vm = this;
          this._platform = root.AlvidaaNativePlatform(sdk, function (data) {
            vm.apps = data.apps.filter(function (app) {
              return app && app.appId != null && text(app.appName) &&
                String(app.appId) !== "vidaa-home" && String(app.appId) !== "206";
            });
            vm.sources = data.sources.filter(function (input) {
              return input && input.sourceId != null;
            });
            vm.status = data.errors.length ? data.errors.join("; ") :
              data.waiting ? "Waiting for TV data…" :
              "Native · " + vm.apps.length + " apps · " + vm.sources.length + " inputs";
            vm.clamp();
          });
          this._platform.start();
          this._clock = setInterval(function () { vm.now = new Date(); }, 1000);
          this._resize = function () { vm.width = (root && root.innerWidth) || 1920; };
          if (root.addEventListener) root.addEventListener("resize", this._resize);
          this.routeFocus();
          // Consume handled keys while bubbling, before document-level defaults.
          // Dialogs get first refusal; unrelated keys pass straight through.
          this._keyDown = function (event) {
            if (sdk.router.isCurrentPathEqualTo("/Launcher") && vm.handleKey(event.keyCode)) {
              event.stopPropagation();
              vm.announce();
            }
          };
          if (root.document && root.document.body) {
            root.document.body.addEventListener("key-down", this._keyDown);
          }
          root.AlvidaaNativeActive = this;
        },
        stop: function () {
          this._running = false;
          if (this._platform) this._platform.stop();
          clearInterval(this._clock);
          if (root.document && root.document.body) {
            root.document.body.removeEventListener("key-down", this._keyDown);
          }
          if (root.removeEventListener) root.removeEventListener("resize", this._resize);
          if (root.AlvidaaNativeActive === this) root.AlvidaaNativeActive = null;
        },
        routeFocus: function () {
          // The dock is the landing view, whether Home was pressed or an input
          // key brought us here. Smart focus lands on the port that is live.
          this.zone = "dock";
          this.overlay = false;
          this.dock = this.smartIndex();
          this.app = 0;
        },
        smartIndex: function () {
          for (var i = 0; i < this.sources.length; i++) {
            if (signalOf(this.sources[i])) return i;
          }
          return 0;
        },
        sourceName: function (input) {
          // Same order as the bridge: the device the TV discovered on the port
          // beats the port label, and a translation id is resolved last.
          var label = text(input.displayname2) || text(input.rename) || text(input.name) ||
            String(input.sourceId);
          if (/^[A-Z]{2,4}[0-9]{4,}$/.test(label) && sdk.i18n && sdk.i18n.t) {
            try {
              var translated = sdk.i18n.t(label);
              if (translated && translated !== label) return translated;
            } catch (_) { return text(input.name) || label; }
            return text(input.name) || label;
          }
          return label;
        },
        localIcon: function (app) {
          var candidates = [app.img, app.presetImg, app.icon, app.appIcon];
          var icon = candidates.filter(function (value) {
            return typeof value === "string" &&
              /^(var\/local\/storeAppIcon\/|file:\/\/\/|\/(?!\/)|data:image\/(png|jpeg|webp);base64,)/i.test(value);
          })[0] || "";
          return icon.indexOf("var/local/storeAppIcon/") === 0 ? "file:///hisenseUI/" + icon : icon;
        },
        dockItems: function () { return this.sources; },
        appItems: function () {
          return [
            { kind: "apps", label: "Apps", glyph: "\u25A6",
              sub: this.apps.length ? this.apps.length + " apps" : "" },
            { kind: "settings", label: "Settings", glyph: "\u2699", sub: "TV settings" }
          ];
        },
        dockStart: function () {
          var n = this.dockItems().length;
          if (n <= DOCK_PAGE) return 0;
          return Math.max(0, Math.min(this.dock - 2, n - DOCK_PAGE));
        },
        clamp: function () {
          this.dock = Math.max(0, Math.min(this.dock, this.dockItems().length - 1));
          this.app = Math.max(0, Math.min(this.app, this.appItems().length - 1));
          this.overlayIndex = Math.max(0, Math.min(this.overlayIndex, this.apps.length - 1));
        },
        run: function (action) {
          var vm = this;
          try {
            var result = action();
            if (result && typeof result.then === "function") {
              result.catch(function (error) { vm.status = "Action failed: " + error.message; });
            }
          } catch (error) { this.status = "Action failed: " + error.message; }
        },
        openOverlay: function () {
          if (!this.apps.length) { this.status = "No apps reported"; return; }
          this.overlay = true;
          this.overlayIndex = 0;
        },
        closeOverlay: function () { this.overlay = false; },
        activate: function () {
          var vm = this;
          if (this.zone === "dock") {
            var input = this.dockItems()[this.dock];
            if (!input) return;
            this.run(function () { return vm._platform.changeSource(input.sourceId); });
            return;
          }
          var item = this.appItems()[this.app];
          if (!item) return;
          if (item.kind === "apps") this.openOverlay();
          else this.run(function () { return vm._platform.openSettings(); });
        },
        launchFocused: function () {
          var vm = this, app = this.apps[this.overlayIndex];
          if (!app) return;
          this.run(function () { return vm._platform.launchApp(app.appId); });
          this.closeOverlay();
        },
        announce: function () {
          if (!sdk.tts || !sdk.tts.isEnable() || !sdk.router.isCurrentPathEqualTo("/Launcher")) return;
          var label;
          if (this.overlay) {
            var app = this.apps[this.overlayIndex];
            label = app && app.appName;
          } else if (this.zone === "dock") {
            var input = this.dockItems()[this.dock];
            label = input && this.sourceName(input);
          } else {
            var item = this.appItems()[this.app];
            label = item && item.label;
          }
          if (label) sdk.tts.speak(label);
        },
        handleKey: function (code) {
          if (this.overlay) {
            if (code === keys.BACK || code === keys.RETURN) { this.closeOverlay(); return true; }
            if (code === keys.ENTER) { this.launchFocused(); return true; }
            if (code === keys.LEFT) this.overlayIndex--;
            else if (code === keys.RIGHT) this.overlayIndex++;
            else if (code === keys.UP) this.overlayIndex -= OVERLAY_COLS;
            else if (code === keys.DOWN) this.overlayIndex += OVERLAY_COLS;
            else return false;
            this.clamp();
            return true;
          }
          if (code === keys.BACK || code === keys.RETURN) {
            // Back closes our own layers, then belongs to the vendor again.
            if (this.zone === "apps") { this.zone = "dock"; return true; }
            return false;
          }
          if (code === keys.ENTER) { this.activate(); return true; }
          if (code === keys.DOWN) { this.zone = "apps"; this.app = 0; return true; }
          if (code === keys.UP) {
            if (this.zone === "apps") { this.zone = "dock"; return true; }
            return false;
          }
          if (code === keys.LEFT) {
            if (this.zone === "dock") this.dock--;
            else this.app--;
          } else if (code === keys.RIGHT) {
            if (this.zone === "dock") this.dock++;
            else this.app++;
          } else return false;
          this.clamp();
          return true;
        }
      },
      render: function (h) {
        var vm = this;
        var scale = (this.width || 1920) / 1920;
        var days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
        var months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY",
          "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
        var dateText = days[this.now.getDay()] + " \u00b7 " + months[this.now.getMonth()] + " " + this.now.getDate();

        function box(x, y, w, height, more) {
          var style = { position: "absolute", left: x * scale + "px", top: y * scale + "px" };
          if (w != null) style.width = w * scale + "px";
          if (height != null) style.height = height * scale + "px";
          Object.keys(more || {}).forEach(function (key) {
            style[key] = typeof more[key] === "number" ? more[key] * scale + "px" : more[key];
          });
          return style;
        }
        function label(x, y, size, value, color, weight) {
          return h("div", { style: box(x, y, null, null, {
            fontSize: size, lineHeight: size + 4, color: color, fontWeight: String(weight || 500)
          }) }, [value]);
        }

        var nodes = [];

        // ---- view 1: clock, big label, inputs dock -------------------------
        nodes.push(h("div", { style: box(112, 56, null, null, {
          fontSize: 116, lineHeight: 120, fontWeight: "300", letterSpacing: "-2px"
        }) }, [
          h("span", { style: { color: "#ffffff" } }, [p2(this.now.getHours())]),
          h("span", { style: { color: "rgba(255,255,255,0.35)" } }, [":"]),
          h("span", { style: { color: "rgba(255,255,255,0.92)" } }, [p2(this.now.getMinutes())])
        ]));
        nodes.push(label(114, 196, 22, dateText, "#8e9ab0", 600));

        if (this.zone === "dock") {
          var focus = this.dockItems()[this.dock];
          if (focus) {
            var live = signalOf(focus);
            nodes.push(label(112, 660, 84, this.sourceName(focus), live ? "#f8fafc" : "#64748b", 700));
            nodes.push(label(114, 752, 26, live ? "connected" : "no signal",
              live ? "#34d399" : "#475569", 500));
          }
        }

        nodes.push(label(112, 812, 22, "INPUTS & SOURCES", "#64748b", 600));

        var dock = this.dockItems(), start = this.dockStart();
        var end = Math.min(dock.length, start + DOCK_PAGE);
        if (!dock.length) {
          nodes.push(label(112, 888, 28, "no inputs reported", "#475569", 500));
        }
        for (var i = start; i < end; i++) {
          var input = dock[i];
          var focused = this.zone === "dock" && this.dock === i;
          var liveInput = signalOf(input);
          var x = 112 + (i - start) * (DOCK_SIZE + DOCK_GAP);
          var tile = [
            h("div", { style: box(16, 16, liveInput ? 96 : 124, 34, {
              borderRadius: 17,
              backgroundColor: liveInput ? "rgba(16,185,129,0.16)" : "rgba(255,255,255,0.04)",
              border: "1px solid " + (liveInput ? "rgba(16,185,129,0.35)" : "rgba(255,255,255,0.08)")
            }) }, [
              h("div", { style: box(14, 14, 6, 6, {
                borderRadius: 3, backgroundColor: liveInput ? "#10b981" : "#64748b"
              }) }),
              h("div", { style: box(28, 0, 68, 34, {
                fontSize: 18, lineHeight: 34, fontWeight: "600",
                color: liveInput ? (focused ? "#6ee7b7" : "#34d399") : "#64748b"
              }) }, [liveInput ? "LIVE" : "STANDBY"])
            ])
          ];
          if (text(input.glyph)) {
            tile.push(h("div", { style: box(0, 42, DOCK_SIZE, 60, {
              fontSize: 52, lineHeight: 60, textAlign: "center",
              color: focused ? "#ffffff" : "#cbd5e1"
            }) }, [text(input.glyph)]));
          } else {
            // Minimal hardware display icon, same as the canvas fallback.
            var ink = focused ? "rgba(255,255,255,0.9)" : "rgba(148,163,184,0.6)";
            tile.push(h("div", { style: box(132, 46, 56, 34, {
              border: "3px solid " + ink, borderRadius: 6
            }) }));
            tile.push(h("div", { style: box(158, 80, 4, 8, { backgroundColor: ink }) }));
            tile.push(h("div", { style: box(148, 88, 24, 3, { backgroundColor: ink }) }));
          }
          tile.push(h("div", { style: box(0, 122, DOCK_SIZE, 40, {
            fontSize: 26, lineHeight: 40, textAlign: "center",
            color: focused ? "#ffffff" : "#94a3b8"
          }) }, [this.sourceName(input)]));
          nodes.push(h("div", {
            attrs: { role: "button", "aria-label": this.sourceName(input), tabindex: focused ? "0" : "-1" },
            style: box(x, 848, DOCK_SIZE, DOCK_HEIGHT, {
              borderRadius: 28,
              backgroundImage: focused ?
                "linear-gradient(180deg, #232a36, #141822)" :
                "linear-gradient(180deg, #161b24, #0d1017)",
              border: "1px solid " + (focused ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)"),
              overflow: "hidden"
            }),
            on: { click: function (index) {
              return function () { vm.zone = "dock"; vm.dock = index; vm.activate(); };
            }(i) }
          }, tile));
        }

        // ---- view 2: the apps row -----------------------------------------
        var rowY = 1080;
        nodes.push(label(112, rowY + 168, 22, "APPS", "#64748b", 600));
        nodes.push(h("div", { style: box(112, rowY + 168, 1696, 24, {
          fontSize: 18, lineHeight: 24, textAlign: "right", color: "#475569"
        }) }, ["OK to open \u00b7 BACK to return"]));
        this.appItems().forEach(function (item, index) {
          var focused = vm.zone === "apps" && vm.app === index;
          var tileX = 112 + index * (DOCK_SIZE + DOCK_GAP);
          var children = [
            h("div", { style: box(0, 42, DOCK_SIZE, 60, {
              fontSize: 52, lineHeight: 60, textAlign: "center",
              color: focused ? "#ffffff" : "#cbd5e1"
            }) }, [item.glyph]),
            h("div", { style: box(0, 108, DOCK_SIZE, 40, {
              fontSize: 26, lineHeight: 40, textAlign: "center",
              color: focused ? "#ffffff" : "#94a3b8"
            }) }, [item.label])
          ];
          if (item.sub) {
            children.push(h("div", { style: box(0, 144, DOCK_SIZE, 26, {
              fontSize: 18, lineHeight: 26, textAlign: "center", color: "#64748b"
            }) }, [item.sub]));
          }
          nodes.push(h("div", {
            attrs: { role: "button", "aria-label": item.label, tabindex: focused ? "0" : "-1" },
            style: box(tileX, rowY + 208, DOCK_SIZE, DOCK_HEIGHT, {
              borderRadius: 28,
              backgroundImage: focused ?
                "linear-gradient(180deg, #232a36, #141822)" :
                "linear-gradient(180deg, #161b24, #0d1017)",
              border: "1px solid " + (focused ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)"),
              overflow: "hidden"
            }),
            on: { click: function () { vm.zone = "apps"; vm.app = index; vm.activate(); } }
          }, children));
        });

        var stage = h("div", { style: {
          position: "absolute", left: "0", top: "0", width: "100%",
          height: 2160 * scale + "px",
          transform: "translateY(" + (this.zone === "apps" ? -1080 * scale : 0) + "px)",
          transition: "transform 350ms ease-out"
        } }, nodes);

        var layers = [
          // Ambient bloom, pure CSS, no image and no network request.
          h("div", { style: {
            position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
            pointerEvents: "none",
            backgroundImage: "linear-gradient(180deg, rgba(56,189,248,0.06), rgba(99,102,241,0.02) 40%, rgba(7,8,12,0) 70%)"
          } }),
          stage,
          h("div", { style: box(112, 1040, null, null, {
            fontSize: 20, lineHeight: 24, color: "#475569"
          }) }, [this.status])
        ];

        // ---- the app list overlay -----------------------------------------
        if (this.overlay) {
          var panelX = 64, panelY = 180, panelW = 1792, panelH = 720;
          var rows = Math.max(1, Math.floor((panelH - 96) / OVERLAY_CELL));
          var firstRow = Math.max(0, Math.floor(this.overlayIndex / OVERLAY_COLS) - rows + 1);
          var first = firstRow * OVERLAY_COLS;
          var cellW = (panelW - 112) / OVERLAY_COLS;
          var panel = [
            h("div", { style: box(panelX + 56, panelY + 40, null, null, {
              fontSize: 22, lineHeight: 24, fontWeight: "600", color: "#64748b"
            }) }, ["APPS"]),
            h("div", { style: box(panelX + 56, panelY + 40, panelW - 112, 24, {
              fontSize: 18, lineHeight: 24, textAlign: "right", color: "#475569"
            }) }, ["OK to open \u00b7 BACK to close"])
          ];
          if (!this.apps.length) {
            panel.push(h("div", { style: box(panelX + 56, panelY + 112, null, null, {
              fontSize: 28, lineHeight: 32, color: "#475569"
            }) }, ["no apps reported"]));
          }
          for (var a = first; a < this.apps.length; a++) {
            var row = Math.floor((a - first) / OVERLAY_COLS), col = a % OVERLAY_COLS;
            if (row >= rows) break;
            var app = this.apps[a];
            var selected = this.overlayIndex === a;
            var cellX = panelX + 56 + col * cellW;
            var cellY = panelY + 96 + row * OVERLAY_CELL;
            var icon = this.localIcon(app);
            var cell = [];
            if (icon) {
              // backgroundImage, not an img node: the img path did not paint
              // cached icons on the Cobalt builds this was tested against.
              cell.push(h("div", { style: box(0, 26, cellW - 16, 72, {
                backgroundImage: "url(" + JSON.stringify(icon) + ")",
                backgroundSize: "contain", backgroundPosition: "center",
                backgroundRepeat: "no-repeat"
              }) }));
            } else {
              cell.push(h("div", { style: box((cellW - 16 - 72) / 2, 26, 72, 72, {
                borderRadius: 16, backgroundColor: "hsl(" + hue(app.appName) + ", 18%, 22%)"
              }) }, [
                h("div", { style: box(0, 0, cellW - 16, 72, {
                  fontSize: 34, lineHeight: 72, textAlign: "center", color: "#e2e8f0"
                }) }, [String(app.appName || "?").charAt(0).toUpperCase()])
              ]));
            }
            var name = String(app.appName || "");
            if (name.length > 18) name = name.slice(0, 17) + "\u2026";
            cell.push(h("div", { style: box(0, OVERLAY_CELL - 60, cellW - 16, 36, {
              fontSize: 22, lineHeight: 36, textAlign: "center",
              color: selected ? "#f8fafc" : "#94a3b8"
            }) }, [name]));
            panel.push(h("div", {
              attrs: { role: "button", "aria-label": String(app.appName || ""), tabindex: selected ? "0" : "-1" },
              style: box(cellX + 8, cellY + 8, cellW - 16, OVERLAY_CELL - 24, {
                borderRadius: 28,
                backgroundColor: selected ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)",
                border: selected ? "2px solid #ffffff" : "2px solid rgba(255,255,255,0)",
                overflow: "hidden"
              }),
              on: { click: function (index) {
                return function () { vm.overlayIndex = index; vm.launchFocused(); };
              }(a) }
            }, cell));
          }
          layers.push(h("div", { style: {
            position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
            backgroundColor: "rgba(3,5,9,0.86)"
          } }, [
            h("div", { style: box(panelX, panelY, panelW, panelH, {
              borderRadius: 48, backgroundColor: "rgba(14,18,26,0.97)",
              border: "1px solid rgba(255,255,255,0.10)", overflow: "hidden"
            }) }, panel)
          ]));
        }

        return h("div", {
          attrs: { id: "alvidaa-native" },
          style: {
            position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
            overflow: "hidden", backgroundColor: "#07080c", color: "#f8fafc",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          }
        }, layers);
      }
    };
  }

  root.AlvidaaNativeHome = create;
  // native-entry.js picks the variant from here. One component per build.
  root.AlvidaaNativeComponent = create;
}(typeof self !== "undefined" ? self : this));

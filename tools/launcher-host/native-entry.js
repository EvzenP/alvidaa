/* Runs after the private, unmodified vendor launcher bundle and our frontend.
 * Replace one component, not the shell or the launcher's other page contracts.
 *
 * One entry for every native variant. A build that ships native-alvidaa.js
 * gets AlvidaaNativeComponent from it; Free My TV builds have no such global
 * and fall back to their own factory. Exactly one component per build.
 */
(function (root) {
  "use strict";
  var original = root._V_M_ && root._V_M_.launcher;
  if (typeof original !== "function") throw new Error("Stock launcher factory is required");
  var create = root.AlvidaaNativeComponent || root.AlvidaaFreeMyTV;
  if (typeof create !== "function") throw new Error("Native Home component is required");
  var wrapped = null;
  root._V_M_.launcher = function () {
    if (wrapped) return wrapped;
    var stock = original();
    var sdk = new root._V_SDK_.vre.SDK("launcher", { storagePrefix: "Alvidaa" });
    var route = stock.route.filter(function (r) { return r.path === "/Launcher"; })[0];
    if (!route) throw new Error("Stock Home route is missing");
    route.component = create(sdk);
    wrapped = stock;
    return stock;
  };
}(self));

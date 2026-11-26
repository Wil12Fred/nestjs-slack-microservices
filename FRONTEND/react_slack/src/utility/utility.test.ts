import { ApiRoutes } from "./apiRoutes";
import { getItem, removeItem, setItem } from "./localStorageControl";

describe("ApiRoutes", () => {
  test("builds a plain route", () => {
    expect(ApiRoutes.createAPIRoute(ApiRoutes.admin.workspace)).toEqual({
      route: "workspace",
    });
  });

  test("builds a detail route", () => {
    expect(ApiRoutes.createAPIRouteDetail(ApiRoutes.admin.channel, "7")).toEqual({
      route: "channel/7",
    });
  });

  test("builds an action route", () => {
    expect(
      ApiRoutes.createAPIRouteAction(ApiRoutes.admin.channel, "7", "message")
    ).toEqual({ route: "channel/7/message" });
  });
});

describe("localStorageControl", () => {
  afterEach(() => localStorage.clear());

  test("stores a string as-is and reads it back", () => {
    setItem("access_token", "abc.def.ghi");
    expect(localStorage.getItem("access_token")).toBe("abc.def.ghi");
    expect(getItem("access_token")).toBe("abc.def.ghi");
  });

  test("serialises numbers and parses them back", () => {
    setItem("workspace", 42);
    expect(getItem("workspace")).toBe(42);
  });

  test("removes a key", () => {
    setItem("access_token", "x");
    removeItem("access_token");
    expect(getItem("access_token")).toBeNull();
  });
});

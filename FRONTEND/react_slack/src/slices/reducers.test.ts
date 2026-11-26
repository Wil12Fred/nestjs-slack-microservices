import authActions from "./authentication/actions";
import AuthReducer from "./authentication/reducer";
import layoutReducer, { changeSidebarTypeAction } from "./Layout/reducer";
import userActions from "./userData/actions";
import { userDataReducer } from "./userData/reducer";

describe("AuthReducer", () => {
  const initial = AuthReducer(undefined, { type: "@@INIT" });

  test("is loading between login begin and success", () => {
    const loading = AuthReducer(initial, authActions.login_begin());
    expect(loading.loading).toBe(true);

    const done = AuthReducer(loading, authActions.login_success(true));
    expect(done).toMatchObject({ login: true, loading: false, error: null });
  });

  test("keeps the error and stops loading when login fails", () => {
    const loading = AuthReducer(initial, authActions.login_begin());
    const failed = AuthReducer(loading, authActions.login_err("bad credentials"));
    expect(failed).toMatchObject({ loading: false, error: "bad credentials" });
  });

  test("ignores unrelated actions", () => {
    expect(AuthReducer(initial, { type: "SOMETHING_ELSE" })).toBe(initial);
  });
});

describe("userDataReducer", () => {
  const initial = userDataReducer(undefined, { type: "@@INIT" });

  test("starts with a placeholder user and no workspace or channel", () => {
    expect(initial).toMatchObject({
      data: { data: { name: "User", lastname: "" } },
      workspace: null,
      channel: null,
      loading: false,
    });
  });

  test("begin, success and error are three different actions", () => {
    const loading = userDataReducer(initial, userActions.user_data_begin());
    expect(loading.loading).toBe(true);

    const user = { name: "Ana", lastname: "Diaz", userId: 1 };
    const loaded = userDataReducer(loading, userActions.user_data_success(user));
    expect(loaded).toMatchObject({ data: user, loading: false });

    const failed = userDataReducer(loading, userActions.user_data_error("boom"));
    expect(failed).toMatchObject({ loading: false, error: "boom" });
  });

  test("selecting a workspace or channel keeps the rest of the state", () => {
    const user = { name: "Ana", lastname: "Diaz" };
    const loaded = userDataReducer(initial, userActions.user_data_success(user));

    const withWorkspace = userDataReducer(
      loaded,
      userActions.user_set_workspace(loaded, { name: "acme", id: "10" })
    );
    const withChannel = userDataReducer(
      withWorkspace,
      userActions.user_set_channel(withWorkspace, { name: "general", id: "100" })
    );

    expect(withChannel).toMatchObject({
      data: user,
      workspace: { name: "acme", id: "10" },
      channel: { name: "general", id: "100" },
    });
  });
});

describe("layout reducer", () => {
  test("changes the sidebar type", () => {
    const state = layoutReducer(undefined, changeSidebarTypeAction("condensed"));
    expect(state.leftSideBarType).toBe("condensed");
  });
});

import {getService} from "@hoppscotch/common/modules/dioc"
import {
  AuthEvent,
  AuthPlatformDef,
  HoppUser,
  AuthTokenType,
} from "@hoppscotch/common/platform/auth"
import {PersistenceService} from "@hoppscotch/common/services/persistence"
import axios from "axios"
import {BehaviorSubject, Subject} from "rxjs"
import {Ref, ref, watch} from "vue"
import {getAllowedAuthProviders, updateUserDisplayName} from "./auth.api"
import * as E from "fp-ts/Either"

export const authEvents$ = new Subject<AuthEvent | { event: "token_refresh" }>()
const currentUser$ = new BehaviorSubject<HoppUser | null>(null)
export const probableUser$ = new BehaviorSubject<HoppUser | null>(null)

const persistenceService = getService(PersistenceService)

function getAccessToken() {
  return persistenceService.getLocalConfig(AuthTokenType.ACCESS_TOKEN)
}

async function logout() {
  await axios.post(`${import.meta.env.VITE_BACKEND_API_URL}/auth/logout`,
    {},
    {
      withCredentials: true,
    })
}

async function signInUserWithGithubFB() {
  window.location.href = `${import.meta.env.VITE_BACKEND_API_URL}/auth/github`
}

async function signInUserWithGoogleFB() {
  window.location.href = `${import.meta.env.VITE_BACKEND_API_URL}/auth/google`
}

async function signInUserWithMicrosoftFB() {
  window.location.href = `${
    import.meta.env.VITE_BACKEND_API_URL
  }/auth/microsoft`
}

async function getInitialUserDetails() {
  const token = getAccessToken()
  const res = await axios.post<{
    data?: {
      me?: {
        uid: string
        displayName: string
        email: string
        photoURL: string
        isAdmin: boolean
        createdOn: string
        // emailVerified: boolean
      }
    }
    errors?: Array<{
      message: string
    }>
  }>(
    `${import.meta.env.VITE_BACKEND_GQL_URL}`,
    {
      query: `query Me {
      me {
        uid
        displayName
        email
        photoURL
        isAdmin
        createdOn
      }
    }`,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      withCredentials: true,
    }
  )

  return res.data
}

const isGettingInitialUser: Ref<null | boolean> = ref(null)

function setUser(user: HoppUser | null) {
  currentUser$.next(user)
  probableUser$.next(user)

  persistenceService.setLocalConfig("login_state", JSON.stringify(user))
}

async function setInitialUser() {
  isGettingInitialUser.value = true
  const curUser = persistenceService.getLocalConfig("login_state")
  // 如果有登录状态，就直接返回
  if(curUser !== null && curUser !== 'null'){
    isGettingInitialUser.value = false
    authEvents$.next({
      event: "login",
      user: JSON.parse(curUser),
    })
    return
  }
  const res = await getInitialUserDetails()

  const error = res.errors && res.errors[0]

  // no cookies sent. so the user is not logged in
  if (error && error.message.includes("auth/cookies_not_found")) {
    setUser(null)
    isGettingInitialUser.value = false
    return
  }

  if (error && error.message === "user/not_found") {
    setUser(null)
    isGettingInitialUser.value = false
    return
  }

  // cookies sent, but it is expired, we need to refresh the token
  if (error && error.message === "Unauthorized") {
    const isRefreshSuccess = await refreshToken()

    if (isRefreshSuccess) {
      setInitialUser()
    } else {
      setUser(null)
      isGettingInitialUser.value = false
      await logout()
    }

    return
  }

  // no errors, we have a valid user
  if (res.data && res.data.me) {
    const hoppBackendUser = res.data.me

    const hoppUser: HoppUser = {
      uid: hoppBackendUser.uid,
      displayName: hoppBackendUser.displayName,
      email: hoppBackendUser.email,
      photoURL: hoppBackendUser.photoURL,
      // all our signin methods currently guarantees the email is verified
      emailVerified: true,
    }

    setUser(hoppUser)

    isGettingInitialUser.value = false

    authEvents$.next({
      event: "login",
      user: hoppUser,
    })

    return
  }
}

async function refreshToken() {
  try {
    const res = await axios.get(
      `${import.meta.env.VITE_BACKEND_API_URL}/auth/refresh`,
      {
        withCredentials: true,
      }
    )

    const isSuccessful = res.status === 200

    if (isSuccessful) {
      authEvents$.next({
        event: "token_refresh",
      })
    }

    return isSuccessful
  } catch (error) {
    return false
  }
}

async function sendMagicLink(email: string) {
  const res = await axios.post(
    `${import.meta.env.VITE_BACKEND_API_URL}/auth/signin`,
    {
      email,
    },
    {
      withCredentials: true,
    }
  )

  if (res.data && res.data.data && res.data.data.deviceIdentifier) {
    persistenceService.setLocalConfig(
      "deviceIdentifier",
      res.data.data.deviceIdentifier
    )
  } else {
    throw new Error("Sign in failed.")
  }

  return res.data.data
}

async function signup(email: string, password: string, confirmPassword: string) {
  const res = await axios.post(
    `${import.meta.env.VITE_BACKEND_API_URL}/auth/signup`,
    {
      email,
      password,
      confirmPassword,
    },
    {
      withCredentials: true,
    }
  )

  if (res.data) {
    if(res.data.code === 'HPS-COM-102'){
      throw new Error("user already exist")
    }
    if(res.data.data && res.data.data.deviceIdentifier){
      persistenceService.setLocalConfig("deviceIdentifier", res.data.data.deviceIdentifier)
    }else {
       throw new Error("Sign up failed")
    }
  } else {
    throw new Error("Sign up failed")
  }
  return res.data.data
}

async function login(email: string, password: string) {
  const res = await axios.post(
    `${import.meta.env.VITE_BACKEND_API_URL}/auth/login`,
    {
      email,
      password,
      origin: 'user',
    },
    {
      withCredentials: true,
    }
  )
  if (!res.data){
    throw new Error("login failed")
  }
  if(res.data.code === 'HPS-COM-103'){
    throw new Error("password not match")
  }
  if(res.data.code === 'HPS-COM-902'){
    throw new Error("user not found")
  }
  if (!res.data.data || !res.data.data.user || !res.data.data.jwtTokenDto) {
    throw new Error("login failed")
  }
  // 设置用户的基本信息
  const hoppBackendUser = res.data.data.user
  const hoppUser: HoppUser = {
    uid: hoppBackendUser.uid,
    displayName: hoppBackendUser.displayName,
    email: hoppBackendUser.email,
    photoURL: hoppBackendUser.photoURL,
    // all our signin methods currently guarantees the email is verified
    emailVerified: true,
  }
  setUser(hoppUser)

  // 设置用户token
  persistenceService.setLocalConfig(
    AuthTokenType.ACCESS_TOKEN,
    res.data.data.jwtTokenDto.accessToken
  )
  persistenceService.setLocalConfig(
    AuthTokenType.REFRESH_TOKEN,
    res.data.data.jwtTokenDto.refreshToken
  )
}

export const def: AuthPlatformDef = {
  getCurrentUserStream: () => currentUser$,
  getAuthEventsStream: () => authEvents$,
  getProbableUserStream: () => probableUser$,

  getCurrentUser: () => currentUser$.value,
  getProbableUser: () => probableUser$.value,

  getBackendHeaders() {
    const token = getAccessToken()
    return {
      Authorization: token ? `Bearer ${token}` : "",
    }
  },
  getGQLClientOptions() {
    return {
      fetchOptions: {
        credentials: "include",
      },
    }
  },

  axiosPlatformConfig() {
    return {
      // for including cookies in the request
      withCredentials: true,
    }
  },

  /**
   * it is not possible for us to know if the current cookie is expired because we cannot access http-only cookies from js
   * hence just returning if the currentUser$ has a value associated with it
   */
  willBackendHaveAuthError() {
    return !currentUser$.value
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onBackendGQLClientShouldReconnect(func) {
    authEvents$.subscribe((event) => {
      if (
        event.event == "login" ||
        event.event == "logout" ||
        event.event == "token_refresh"
      ) {
        func()
      }
    })
  },

  /**
   * we cannot access our auth cookies from javascript, so leaving this as null
   */
  getDevOptsBackendIDToken() {
    return null
  },
  async performAuthInit() {
    const probableUser = JSON.parse(
      persistenceService.getLocalConfig("login_state") ?? "null"
    )
    probableUser$.next(probableUser)
    await setInitialUser()
  },

  waitProbableLoginToConfirm() {
    return new Promise<void>((resolve, reject) => {
      if (this.getCurrentUser()) {
        resolve()
      }

      if (!probableUser$.value) reject(new Error("no_probable_user"))

      const unwatch = watch(isGettingInitialUser, (val) => {
        if (val === true || val === false) {
          resolve()
          unwatch()
        }
      })
    })
  },

  async signInWithEmail(email: string) {
    await sendMagicLink(email)
  },

  isSignInWithEmailLink(url: string) {
    const urlObject = new URL(url)
    const searchParams = new URLSearchParams(urlObject.search)

    return !!searchParams.get("token")
  },

  async verifyEmailAddress() {
    return
  },
  async signInUserWithGoogle() {
    await signInUserWithGoogleFB()
  },
  async signInUserWithGithub() {
    await signInUserWithGithubFB()
    return undefined
  },
  async signInUserWithMicrosoft() {
    await signInUserWithMicrosoftFB()
  },
  async signInWithEmailLink(email: string, url: string) {
    const urlObject = new URL(url)
    const searchParams = new URLSearchParams(urlObject.search)

    const token = searchParams.get("token")

    const deviceIdentifier =
      persistenceService.getLocalConfig("deviceIdentifier")

    const res = await axios.post(
      `${import.meta.env.VITE_BACKEND_API_URL}/auth/verify`,
      {
        token: token,
        deviceIdentifier,
      },
      {
        withCredentials: true,
      }
    )
    if (res.data && res.data.data && res.data.data.accessToken && res.data.data.refreshToken) {
      persistenceService.setLocalConfig(
        AuthTokenType.ACCESS_TOKEN,
        res.data.data.accessToken
      )
      persistenceService.setLocalConfig(
        AuthTokenType.REFRESH_TOKEN,
        res.data.data.refreshToken
      )
    } else {
      throw new Error("test: accessToken or refreshToken not found")
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setEmailAddress(_email: string) {
    return
  },

  async setDisplayName(name: string) {
    if (!name) return E.left("USER_NAME_CANNOT_BE_EMPTY")
    if (!currentUser$.value) return E.left("NO_USER_LOGGED_IN")

    const res = await updateUserDisplayName(name)

    if (E.isRight(res)) {
      setUser({
        ...currentUser$.value,
        displayName: res.right.updateDisplayName.displayName ?? null,
      })

      return E.right(undefined)
    }
    return E.left(res.left)
  },

  async signOutUser() {
    // if (!currentUser$.value) throw new Error("No user has logged in")

    await logout()

    probableUser$.next(null)
    currentUser$.next(null)

    persistenceService.removeLocalConfig("login_state")
    persistenceService.removeLocalConfig(AuthTokenType.ACCESS_TOKEN)
    persistenceService.removeLocalConfig(AuthTokenType.REFRESH_TOKEN)

    authEvents$.next({
      event: "logout",
    })
  },

  async processMagicLink() {
    if (this.isSignInWithEmailLink(window.location.href)) {
      const deviceIdentifier =
        persistenceService.getLocalConfig("deviceIdentifier")

      if (!deviceIdentifier) {
        throw new Error(
          "Device Identifier not found, you can only signin from the browser you generated the magic link"
        )
      }

      await this.signInWithEmailLink(deviceIdentifier, window.location.href)

      persistenceService.removeLocalConfig("deviceIdentifier")
      window.location.href = "/"
    }
  },
  getAllowedAuthProviders,

  async login(email: string, password: string): Promise<void> {
    return await login(email, password)
  },

  async signup(email: string, password: string, confirmPassword: string): Promise<void> {
    return await signup(email, password, confirmPassword)
  },
}

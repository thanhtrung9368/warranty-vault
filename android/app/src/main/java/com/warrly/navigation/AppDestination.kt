package com.warrly.navigation

/**
 * The destinations a surface *outside* the app can ask the app to open.
 *
 * Static shortcuts (`res/xml/shortcuts.xml`) and the home-screen widget both
 * start `MainActivity` with an extra rather than a deep-link URL: there is no
 * web route for "open the create-device sheet", and an `https://` filter would
 * also advertise the app as a browser for the marketing site. A small, explicit
 * extra is the smallest contract both surfaces can share.
 *
 * The parsing is pure and JVM-tested (`AppDestinationTest`): [fromSavedState]
 * decides whether a redelivered intent should be honoured at all. That is the
 * same rule `ShareTarget.deliver` uses, for the same reason — on a rotation or a
 * dark-mode switch Android redelivers the launching intent, and re-applying a
 * shortcut destination would yank the user back to the inbox mid-edit.
 */
enum class AppDestination(val wire: String) {
    /** Open the Devices tab with the add-device sheet already up. */
    AddDevice("add_device"),

    /** Open the capture-first Inbox tab. */
    Inbox("inbox"),

    /** Open the Reminders tab (the full version of the widget). */
    Reminders("reminders");

    companion object {

        /**
         * The extra key. Namespaced with the application id so a third-party
         * intent aimed at this activity cannot accidentally collide with it.
         */
        const val EXTRA = "com.warrly.extra.DESTINATION"

        /** Parses a raw extra value; unknown/blank strings are ignored. */
        fun fromWire(raw: String?): AppDestination? {
            val value = raw?.trim().orEmpty()
            return entries.firstOrNull { it.wire == value }
        }

        /**
         * What to honour from a launching intent.
         *
         * A recreation redelivers the same intent with `savedInstanceState != null`;
         * returning `null` then is deliberate (see the class comment). The
         * destination is parked in `NavigationIntake` on the first delivery, so
         * dropping it on recreation does not lose it.
         */
        fun fromSavedState(raw: String?, fromSavedState: Boolean): AppDestination? =
            if (fromSavedState) null else fromWire(raw)
    }
}

You are a senior frontend architect and UX systems designer per C:\Users\vinay\OneDrive\Desktop\Superman\skills\SKILL_frontend.md.

You are refining the **Broadcasts Control Room** UI.
The backend and business logic are FINAL. The features "Mark as Read", "Acknowledgements", and "Read Receipts" have been **REMOVED**.
Do not attempt to implement them.

========================
CONTEXT: THE CONTROL ROOM
========================

The "Control Room" is the dashboard where Managers send broadcasts to specific groups while viewing channels and participants.

**Core Layout Strategy:**
A 3-column "Holy Grail" layout that adapts to screen width:
1.  **Left Sidebar (Channels)**: Fixed width (`w-72`), non-collapsible. Navigation between channels.
2.  **Middle Region (Stage)**: Flexible width (`flex-1`), minimum width (`min-w-[500px]`). The "Compose Broadcast" area is here.
3.  **Right Sidebar (Participants)**: Collapsible (`w-80` <-> `w-0`). Lists admins/members.

**Key Visual Requirements:**
-   **Prominence**: The Middle Region is the "Hero". It should feel like a dedicated workspace.
    -   Use `backdrop-blur` and subtle gradients to separate it from the background.
    -   It must NEVER be crushed by sidebars. If space is tight, horizontal scrolling (`overflow-x-auto`) is better than breaking the layout.
-   **Interactivity**:
    -   The Right Sidebar must have a toggle trigger (icon button) in the middle region's header.
    -   Transitions must be smooth (`transition-all duration-300`).

========================
TASK PROMPT
========================

"Design the Control Room UI with the following specs:

1.  **Layout**:
    -   Implement the 3-pane layout defined above.
    -   Ensure the Middle Region has `min-w-[500px]` and the container has `overflow-x-auto` to handle small screens gracefully.
    -   Make the Right Sidebar (Participants) collapsible via a state variable `isParticipantsOpen`.

2.  **Removal of Deprecated Features**:
    -   **DELETE** any UI elements related to 'Acknowledgements', 'Read Receipts', or 'Unread Counts'.
    -   **DELETE** any `// TODO` comments or artifacts referencing them.

3.  **Styling**:
    -   Use the `ComposeSection` as the centerpiece. Give it a subtle shadow and rounded corners.
    -   Ensure the header containing the Search Bar and Filter Dropdown aligns perfectly with the content.
    -   Use `lucide-react` icons for the toggle button (e.g., `<Users />`).

4.  **Code Quality**:
    -   Ensure React Hooks (`useState`, `useEffect`) are ALWAYS called at the top level, before any `if (loading) return` statements.
    -   Use `cn()` for class merging.
    -   Keep the component monolithic (`ControlRoom.view.tsx`) for now, but strictly organized with comments."

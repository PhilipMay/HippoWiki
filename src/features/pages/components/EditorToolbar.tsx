"use client";

import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ChecklistIcon from "@mui/icons-material/Checklist";
import CodeIcon from "@mui/icons-material/Code";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import LinkIcon from "@mui/icons-material/Link";
import StrikethroughSIcon from "@mui/icons-material/StrikethroughS";
import TitleIcon from "@mui/icons-material/Title";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ToggleButton from "@mui/material/ToggleButton";
import Tooltip from "@mui/material/Tooltip";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import type { FormatAction } from "@/features/pages/editor/commands";
import type { EditorMode } from "@/features/pages/editor/mode";
import type { EditorHandle } from "@/features/pages/editor/mount";

// Nothing to subscribe to: the platform does not change while the page is open.
const subscribe = () => () => {};

/** Whether the browser runs on an Apple platform, whose shortcuts use Cmd; false on the server. */
function useApple(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => false,
  );
}

/** A button of the toolbar: its action, its accessible name, its icon and the key of its shortcut. */
type ToolbarButton = { action: FormatAction; name: string; icon: ReactNode; key?: string };

const INLINE_BUTTONS: ToolbarButton[] = [
  { action: "bold", name: "Bold", icon: <FormatBoldIcon />, key: "B" },
  { action: "italic", name: "Italic", icon: <FormatItalicIcon />, key: "I" },
  { action: "strikethrough", name: "Strikethrough", icon: <StrikethroughSIcon /> },
  { action: "code", name: "Inline code", icon: <CodeIcon /> },
];

const LINK_BUTTON: ToolbarButton = { action: "link", name: "Link", icon: <LinkIcon />, key: "K" };

const LIST_BUTTONS: ToolbarButton[] = [
  { action: "bullet", name: "Bullet list", icon: <FormatListBulletedIcon /> },
  { action: "numbered", name: "Numbered list", icon: <FormatListNumberedIcon /> },
  { action: "task", name: "Task list", icon: <ChecklistIcon /> },
];

const HEADINGS: { action: FormatAction; name: string }[] = [
  { action: "normal", name: "Normal text" },
  { action: "heading1", name: "Heading 1" },
  { action: "heading2", name: "Heading 2" },
  { action: "heading3", name: "Heading 3" },
];

/**
 * The CSS variable with the height of the toolbar, set on the frame of the editor, so that the search panel of the
 * editor sticks below the toolbar instead of under it.
 */
const TOOLBAR_HEIGHT_VARIABLE = "--editor-toolbar-height";

const MODES: { value: EditorMode; name: string }[] = [
  { value: "live", name: "Live preview" },
  { value: "source", name: "Source" },
];

/** Keeps the focus in the editor: the buttons do not take it on mouse down. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

type EditorToolbarProps = {
  /** The editor, or `null` until it is ready; the buttons are disabled until then. */
  editor: EditorHandle | null;
  /** The mode of the editor, which the switch at the right end of the toolbar shows. */
  mode: EditorMode;
  /** Called with the mode the switch chooses. */
  onModeChange(mode: EditorMode): void;
};

/**
 * The formatting toolbar above the editor: bold, italic, strikethrough, inline code, a heading menu, link,
 * bullet list, numbered list and task list. Each button has an accessible name and a tooltip with its name and, for
 * bold, italic and link, its shortcut. A button leaves the focus in the editor. The toolbar sticks to the top of
 * the window while the editor is in view and wraps its buttons on a narrow screen.
 */
export default function EditorToolbar({ editor, mode, onModeChange }: EditorToolbarProps) {
  const apple = useApple();
  const [headingMenu, setHeadingMenu] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const toolbarRef = useRef<HTMLDivElement>(null);

  // The height changes when the buttons wrap onto a second row.
  useEffect(() => {
    const toolbar = toolbarRef.current;
    const frame = toolbar?.parentElement;
    if (!toolbar || !frame) return;
    const observer = new ResizeObserver(() =>
      frame.style.setProperty(TOOLBAR_HEIGHT_VARIABLE, `${toolbar.offsetHeight}px`),
    );
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  const tooltip = ({ name, key }: { name: string; key?: string }) =>
    key === undefined ? name : `${name} (${apple ? `⌘${key}` : `Ctrl+${key}`})`;

  /** The tooltip shows only on an enabled control: Material UI does not show one on a disabled button. */
  const withTooltip = (title: string, control: ReactElement) =>
    editor ? <Tooltip title={title}>{control}</Tooltip> : control;

  const iconButton = (button: ToolbarButton) => (
    <span key={button.action}>
      {withTooltip(
        tooltip(button),
        <IconButton
          aria-label={button.name}
          size="small"
          disabled={!editor}
          onMouseDown={keepFocus}
          onClick={() => editor?.format(button.action)}
        >
          {button.icon}
        </IconButton>,
      )}
    </span>
  );

  const chooseHeading = (action: FormatAction) => {
    editor?.format(action);
    setHeadingMenu(null);
  };

  return (
    <Box
      ref={toolbarRef}
      role="toolbar"
      aria-label="Formatting"
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 0.5,
        px: 1,
        py: 0.5,
        bgcolor: "background.paper",
        borderBottom: 1,
        borderColor: "divider",
        borderTopLeftRadius: "inherit",
        borderTopRightRadius: "inherit",
      }}
    >
      {INLINE_BUTTONS.map(iconButton)}
      <span>
        {withTooltip(
          "Heading",
          <Button
            size="small"
            color="inherit"
            aria-label="Heading"
            aria-haspopup="menu"
            aria-controls={headingMenu ? menuId : undefined}
            aria-expanded={headingMenu ? "true" : undefined}
            disabled={!editor}
            onMouseDown={keepFocus}
            onClick={(event) => setHeadingMenu(event.currentTarget)}
            endIcon={<ArrowDropDownIcon />}
            sx={{ minWidth: 0 }}
          >
            <TitleIcon />
          </Button>,
        )}
      </span>
      <Menu
        id={menuId}
        anchorEl={headingMenu}
        open={headingMenu !== null}
        onClose={() => setHeadingMenu(null)}
        // The focus goes back to the editor, not to the button of the menu, once the menu has closed: before then its
        // focus trap would take the focus back.
        disableRestoreFocus
        slotProps={{ transition: { onExited: () => editor?.focus() } }}
      >
        {HEADINGS.map(({ action, name }) => (
          <MenuItem key={action} onClick={() => chooseHeading(action)}>
            {name}
          </MenuItem>
        ))}
      </Menu>
      {iconButton(LINK_BUTTON)}
      {LIST_BUTTONS.map(iconButton)}
      {/* The switch between the modes, at the right end, marks the current mode as pressed. Two buttons of
          their own, each a stop of Tab: the group of Material UI has one stop, which does not follow the pressed
          button when the buttons never take the focus. */}
      <Box role="group" aria-label="Mode" sx={{ ml: "auto", display: "flex" }}>
        {MODES.map(({ value, name }, index) => (
          <ToggleButton
            key={value}
            value={value}
            size="small"
            selected={mode === value}
            disabled={!editor}
            onMouseDown={keepFocus}
            onChange={() => {
              if (mode !== value) onModeChange(value);
              editor?.focus();
            }}
            sx={{
              py: 0.25,
              textTransform: "none",
              ...(index === 0
                ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 }
                : { borderTopLeftRadius: 0, borderBottomLeftRadius: 0, ml: "-1px" }),
            }}
          >
            {name}
          </ToggleButton>
        ))}
      </Box>
    </Box>
  );
}

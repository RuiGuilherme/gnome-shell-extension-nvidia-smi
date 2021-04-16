/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

// KEEP
// THIS
// AS
// SIMPLE
// AS
// POSSIBLE

// Gnome Shell imports
const { GObject, St, GLib, Clutter, Gio } = imports.gi
const { extensionUtils, util } = imports.misc
const { panelMenu, main, popupMenu } = imports.ui
const Mainloop = imports.mainloop

// others
const { ActorAlign } = Clutter
const Me = extensionUtils.getCurrentExtension()
const GETTEXT_DOMAIN = 'my-indicator-extension'
const Gettext = imports.gettext.domain(GETTEXT_DOMAIN)
const _ = Gettext.gettext
const Clipboard = St.Clipboard.get_default()
const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD

// local imports files
const toXML = Me.imports.tXml

// local imports functions from files
const parseToXML = toXML.parse
const simplifyXML = toXML.simplify
const bytesToArray = imports.byteArray

const getItems = () => {
	// Expected data
	const nvidiaSMI = GLib.find_program_in_path('nvidia-smi')
	const stringOut = bytesToArray.toString(GLib.spawn_command_line_sync(`${nvidiaSMI} -q --xml-format`)[1])
	const logObj = simplifyXML(parseToXML(stringOut))

	const { nvidia_smi_log } = logObj
	const { driver_version, gpu, cuda_version } = nvidia_smi_log
	const { product_name, utilization, processes, fb_memory_usage, vbios_version } = gpu
	const { process_info } = processes

	return {
		vbios_version,
		cuda_version,
		driver_version,
		product_name,
		process_info: process_info[0] === undefined ? [process_info] : process_info,
		utilization,
		fb_memory_usage
	}
}

const Indicator = GObject.registerClass(
	class Indicator extends panelMenu.Button {
		_init() {
			super._init(0.0)
			const gpuIcon = Gio.icon_new_for_string(Me.path + '/icons/material-gpu-temperature-symbolic.svg')

			this.add_child(
				new St.Icon({
					gicon: gpuIcon,
					style_class: 'system-status-icon'
				})
			)

			this._onStart() //build ui with initial values from nvidia-smi
			this._onLoopUpdate() //start recursive loop to update values
		}

		_onLoopUpdate() {
			Mainloop.timeout_add(3000, () => {
				this._onUpdateValue()
				this._onLoopUpdate()
			})
		}

		_onStart() {
			// get initial values from nvidia-smi
			const { driver_version, product_name, vbios_version, process_info, utilization, fb_memory_usage, cuda_version } = getItems()

			this.pid = []

			const staticMenu = [
				{
					label: '',
					value: product_name,
					position: null,
					isDefault: true,
					hasSeparator: false
				},
				{
					label: _('Driver v'),
					value: driver_version,
					position: null,
					isDefault: true,
					hasSeparator: false
				},
				{
					label: _('Cuda v'),
					value: cuda_version,
					position: null,
					isDefault: true,
					hasSeparator: false
				},
				{
					label: _('BIOS v'),
					value: vbios_version,
					position: null,
					isDefault: true,
					hasSeparator: false
				},
				{
					label: _('Processes'),
					value: '',
					position: ActorAlign.CENTER,
					isDefault: true,
					hasSeparator: true
				}
			]

			staticMenu.map((props) => {
				const { label, value, position, isDefault, hasSeparator } = props

				if (!isDefault) return

				if (hasSeparator) {
					this.menu.addMenuItem(new popupMenu.PopupSeparatorMenuItem())
				}

				const staticMenu = new popupMenu.PopupBaseMenuItem()
				const staticLabel = new St.Label({ text: label + value, x_expand: true, x_align: position })

				staticMenu.actor.add_child(staticLabel)

				this.menu.addMenuItem(staticMenu)
			})

			this._onBuildProcessesMenu(process_info)

			this.menu.addMenuItem(new popupMenu.PopupSeparatorMenuItem())

			this._onBuildUtilizationMenu(utilization)
			this._onBuildMemoryUsage(fb_memory_usage)
			this._onBuildForkMenu()
		}

		_onUpdateValue() {
			const { process_info, utilization, fb_memory_usage } = getItems()
			this._onUpdateMemoryUsage(fb_memory_usage)
			this._onUpdateUtilization(utilization)
			this._onUpdateProcessesMenu(process_info)
		}

		_onUpdateMemoryUsage(fb_memory_usage) {
			const { free, total, used } = fb_memory_usage
			this.labelTotalMenu.text = _('Total: ') + total
			this.labelUsedMenu.text = _('Used: ') + used
			this.labelFreeMenu.text = _('Free: ') + free
		}

		_onBuildMemoryUsage(fb_memory_usage) {
			const { free, total, used } = fb_memory_usage

			const totalMenu = new popupMenu.PopupBaseMenuItem()
			const usedMenu = new popupMenu.PopupBaseMenuItem()
			const freeMenu = new popupMenu.PopupBaseMenuItem()

			this.labelTotalMenu = new St.Label({ text: _('Total: ') + total, x_expand: true })
			this.labelUsedMenu = new St.Label({ text: _('Used: ') + used, x_expand: true })
			this.labelFreeMenu = new St.Label({ text: _('Free: ') + free, x_expand: true })

			totalMenu.actor.add_child(this.labelTotalMenu)
			usedMenu.actor.add_child(this.labelUsedMenu)
			freeMenu.actor.add_child(this.labelFreeMenu)

			const memoryMenuExpander = new popupMenu.PopupSubMenuMenuItem(_('Memory Usage'), true)

			memoryMenuExpander.menu.addMenuItem(totalMenu)
			memoryMenuExpander.menu.addMenuItem(usedMenu)
			memoryMenuExpander.menu.addMenuItem(freeMenu)

			this.menu.addMenuItem(memoryMenuExpander)
		}

		_onUpdateUtilization(utilization) {
			const { decoder_util, encoder_util, gpu_util, memory_util } = utilization

			this.labelDecoderMenu.text = _('Decoder: ') + decoder_util
			this.labelEncoderMenu.text = _('Enconder: ') + encoder_util
			this.labelGpuMenu.text = _('GPU: ') + gpu_util
			this.labelMemoryMenu.text = _('Memory: ') + memory_util
		}

		_onBuildUtilizationMenu(utilization) {
			const { decoder_util, encoder_util, gpu_util, memory_util } = utilization

			this.decoderMenu = new popupMenu.PopupBaseMenuItem()
			this.encoderMenu = new popupMenu.PopupBaseMenuItem()
			this.gpuMenu = new popupMenu.PopupBaseMenuItem()
			this.memoryMenu = new popupMenu.PopupBaseMenuItem()

			this.labelDecoderMenu = new St.Label({ text: _('Decoder: ') + decoder_util, x_expand: true })
			this.labelEncoderMenu = new St.Label({ text: _('Enconder: ') + encoder_util, x_expand: true })
			this.labelGpuMenu = new St.Label({ text: _('GPU: ') + gpu_util, x_expand: true })
			this.labelMemoryMenu = new St.Label({ text: _('Memory: ') + memory_util, x_expand: true })

			this.decoderMenu.actor.add_child(this.labelDecoderMenu)
			this.encoderMenu.actor.add_child(this.labelEncoderMenu)
			this.gpuMenu.actor.add_child(this.labelGpuMenu)
			this.memoryMenu.actor.add_child(this.labelMemoryMenu)

			this.utilizationMenuExpander = new popupMenu.PopupSubMenuMenuItem(_('Status'), true)

			this.utilizationMenuExpander.menu.addMenuItem(this.decoderMenu)
			this.utilizationMenuExpander.menu.addMenuItem(this.encoderMenu)
			this.utilizationMenuExpander.menu.addMenuItem(this.gpuMenu)
			this.utilizationMenuExpander.menu.addMenuItem(this.memoryMenu)

			this.menu.addMenuItem(this.utilizationMenuExpander)
		}

		_onUpdateProcessesMenu(process_info) {
			const process_info_id = []
			process_info.forEach((element) => process_info_id.push(element.pid))

			if (!(process_info_id.sort().join(',') === this.pid.sort().join(','))) {
				this.menu.removeAll()
				this._onStart()
			}
		}

		_onBuildProcessesMenu(process_info) {
			process_info.map((props) => {
				const { pid, process_name } = props
				// Ohh yess SPLITTTT
				const processName = process_name.split(' ')[0]
				const pathSplit = processName.split('/')
				const realName = pathSplit[pathSplit.length - 1]

				this.pid.push(pid)

				const pidMenu = new popupMenu.PopupBaseMenuItem()
				const pathMenu = new popupMenu.PopupBaseMenuItem()
				const htopMenu = new popupMenu.PopupBaseMenuItem()

				const labelPidMenu = new St.Label({ text: _('PID: ') + pid, x_expand: true })
				const labelPathMenu = new St.Label({ text: _('Path to clipboard'), x_align: ActorAlign.CENTER, x_expand: true })
				const labelHtopMenu = new St.Label({ text: _('Open on htop'), x_align: ActorAlign.CENTER, x_expand: true })

				pidMenu.actor.add_child(labelPidMenu)
				pathMenu.actor.add_child(labelPathMenu)
				htopMenu.actor.add_child(labelHtopMenu)

				// events
				pathMenu.connect('activate', () => {
					Clipboard.set_text(CLIPBOARD_TYPE, processName)
				})

				htopMenu.connect('activate', () => {
					util.spawnApp([`gnome-terminal -x bash -c "htop -p ${pid}"`])
				})

				const genericMenu = new popupMenu.PopupSubMenuMenuItem(realName, true)

				genericMenu.menu.addMenuItem(pidMenu)
				genericMenu.menu.addMenuItem(new popupMenu.PopupSeparatorMenuItem())
				genericMenu.menu.addMenuItem(pathMenu)
				genericMenu.menu.addMenuItem(htopMenu)

				this.menu.addMenuItem(genericMenu)
			})
		}

		// Just a static menu with link to github repository
		_onBuildForkMenu() {
			this.menu.addMenuItem(new popupMenu.PopupSeparatorMenuItem())

			const gitPage = new popupMenu.PopupBaseMenuItem()
			const gitLabel = new St.Label({ text: _('Fork me on GitHub'), x_align: ActorAlign.CENTER, x_expand: true })

			gitPage.actor.add_child(gitLabel)
			gitPage.connect('activate', function () {
				util.spawn(['xdg-open', 'https://github.com/RuiGuilherme/gnome-shell-extension-nvidia-smi'])
			})
			this.menu.addMenuItem(gitPage)
		}
	}
)

class Extension {
	constructor(uuid) {
		this._uuid = uuid

		extensionUtils.initTranslations(GETTEXT_DOMAIN)
	}

	enable() {
		this._indicator = new Indicator()
		main.panel.addToStatusArea(this._uuid, this._indicator)
	}

	disable() {
		this._indicator.destroy()
		this._indicator = null
	}
}

function init(meta) {
	return new Extension(meta.uuid)
}

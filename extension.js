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

const getItems = () => {
	// Expected data
	const nvidiaSMI = GLib.find_program_in_path('nvidia-smi')
	const stringOut = GLib.spawn_command_line_sync(`${nvidiaSMI} -q --xml-format`)[1].toString()

	const logObj = simplifyXML(parseToXML(stringOut))

	const { nvidia_smi_log } = logObj
	const { driver_version, gpu, cuda_version } = nvidia_smi_log
	const { product_name, utilization, processes, fb_memory_usage, vbios_version } = gpu
	const { process_info } = processes

	// Optional itens: - futere plans
	/*
		{graphics_clock, mem_clock, sm_clock, video_clock} = max_clocks,
		{used, total, free} = bar1_memory_usage,
		String = fan_speed,
		{current_gom, pending_gom} = gpu_operation_mode,
		{graphics_clock, mem_clock} = applications_clocks,
		{graphics_clock, mem_clock} = default_applications_clocks,
		{current_dm, pending_dm} = driver_model,
		{host_vgpu_mode, virtualization_mode} = gpu_virtualization_mode,
		String = persistence_mode,
		String = performance_state,
		String = power_readings,
		String = supported_clocks,
		{gpu_target_temp_max, gpu_target_temp_min} = supported_gpu_target_temp,
		{gpu_target_temperature, gpu_temp, gpu_temp_max_gpu_threshold, gpu_temp_max_mem_threshold, gpu_temp_max_threshold, gpu_temp_slow_threshold, memory_temp} = temperature,
		String = uuid
		{graphics_clock, mem_clock, sm_clock, video_clock} = clocks
	*/

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

			this._onStart()
			this._onLoopUpdate()
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
			this.pidMenu = []
			this.memoryMenu = []
			this.pathMenu = []
			this.htopMenu = []

			this.labelPidMenu = []
			this.labelMemoryMenuP = []
			this.labelPathMenu = []
			this.labelHtopMenu = []

			this.genericMenu = []

			this.gpuMenu = new popupMenu.PopupBaseMenuItem()
			this.driverMenu = new popupMenu.PopupBaseMenuItem()
			this.cudaMenu = new popupMenu.PopupBaseMenuItem()
			this.biosMenu = new popupMenu.PopupBaseMenuItem()
			this.processMenu = new popupMenu.PopupBaseMenuItem()

			this.labelGPUMenu = new St.Label({ text: product_name, x_expand: true })
			this.labelDriverMenu = new St.Label({ text: _('Driver v') + driver_version, x_expand: true })
			this.labelCudaMenu = new St.Label({ text: _('Cuda v') + cuda_version, x_expand: true })
			this.labelBiosMenu = new St.Label({ text: _('BIOS v') + vbios_version, x_expand: true })
			this.labelProcessMenu = new St.Label({ text: _('Processes'), x_align: ActorAlign.CENTER, x_expand: true })

			this.gpuMenu.actor.add_child(this.labelGPUMenu)
			this.driverMenu.actor.add_child(this.labelDriverMenu)
			this.cudaMenu.actor.add_child(this.labelCudaMenu)
			this.biosMenu.actor.add_child(this.labelBiosMenu)
			this.processMenu.actor.add_child(this.labelProcessMenu)

			// Static menus
			this.menu.addMenuItem(this.gpuMenu)
			this.menu.addMenuItem(this.driverMenu)
			this.menu.addMenuItem(this.cudaMenu)
			this.menu.addMenuItem(this.biosMenu)

			// Processes menu
			this.menu.addMenuItem(new popupMenu.PopupSeparatorMenuItem())
			this.menu.addMenuItem(this.processMenu)
			this._onBuildProcessesMenu(process_info)
			this.menu.addMenuItem(new popupMenu.PopupSeparatorMenuItem())

			// Others
			this._onBuildUtilizationMenu(utilization)
			this._onBuildMemoryUsage(fb_memory_usage)
			this._onFork()
		}

		_onUpdateValue() {
			const { process_info, utilization, fb_memory_usage } = getItems()

			const { decoder_util, encoder_util, gpu_util, memory_util } = utilization
			this.labelDecoderMenu.text = _('Decoder: ') + decoder_util
			this.labelEncoderMenu.text = _('Enconder: ') + encoder_util
			this.labelGpuMenu.text = _('GPU: ') + gpu_util
			this.labelMemoryMenu.text = _('Memory: ') + memory_util

			const { free, total, used } = fb_memory_usage
			this.labelTotalMenu.text = _('Total: ') + total
			this.labelUsedMenu.text = _('Used: ') + used
			this.labelFreeMenu.text = _('Free: ') + free

			const process_info_id = []
			process_info.forEach((element) => process_info_id.push(element.pid))

			if (process_info_id.sort().join(',') === this.pid.sort().join(',')) {
				this.pid.map((prop, key) => {
					process_info.map((props) => {
						const { pid, used_memory } = props
						if (pid.indexOf(prop) !== -1) {
							this.labelMemoryMenuP[key].text = _('Memory: ') + used_memory
						}
					})
				})
			} else {
				/*
					removeAll() and force reender 	ui 
					It was the best way I thought to remove old processes and add new processes
					without leaving it complicated.
				*/
				this.menu.removeAll()
				this._onStart()
			}
		}

		_onBuildMemoryUsage(fb_memory_usage) {
			const { free, total, used } = fb_memory_usage

			this.totalMenu = new popupMenu.PopupBaseMenuItem()
			this.usedMenu = new popupMenu.PopupBaseMenuItem()
			this.freeMenu = new popupMenu.PopupBaseMenuItem()

			this.labelTotalMenu = new St.Label({ text: _('Total: ') + total, x_expand: true })
			this.labelUsedMenu = new St.Label({ text: _('Used: ') + used, x_expand: true })
			this.labelFreeMenu = new St.Label({ text: _('Free: ') + free, x_expand: true })

			this.totalMenu.actor.add_child(this.labelTotalMenu)
			this.usedMenu.actor.add_child(this.labelUsedMenu)
			this.freeMenu.actor.add_child(this.labelFreeMenu)

			this.memoryMenuExpander = new popupMenu.PopupSubMenuMenuItem(_('Memory Usage'), true)

			this.memoryMenuExpander.menu.addMenuItem(this.totalMenu)
			this.memoryMenuExpander.menu.addMenuItem(this.usedMenu)
			this.memoryMenuExpander.menu.addMenuItem(this.freeMenu)

			this.menu.addMenuItem(this.memoryMenuExpander)
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

		_onBuildProcessesMenu(process_info) {
			process_info.map((props, key) => {
				const { pid, process_name, used_memory } = props
				// Ohh yess SPLITTTT
				const processName = process_name.split(' ')[0]
				const pathSplit = processName.split('/')
				const realName = pathSplit[pathSplit.length - 1]

				this.pid[key] = pid

				// const fullNameMenu = new popupMenu.PopupBaseMenuItem()
				this.pidMenu[key] = new popupMenu.PopupBaseMenuItem()
				this.memoryMenu[key] = new popupMenu.PopupBaseMenuItem()
				this.pathMenu[key] = new popupMenu.PopupBaseMenuItem()
				this.htopMenu[key] = new popupMenu.PopupBaseMenuItem()

				// const labelFullNameMenuMenu = new St.Label({ text: `Path: ${processName}`, x_expand: true })
				this.labelPidMenu[key] = new St.Label({ text: _('PID: ') + pid, x_expand: true })
				this.labelMemoryMenuP[key] = new St.Label({ text: _('Memory: ') + used_memory, x_expand: true })
				this.labelPathMenu[key] = new St.Label({ text: _('Path to clipboard'), x_align: ActorAlign.CENTER, x_expand: true })
				this.labelHtopMenu[key] = new St.Label({ text: _('Open on htop'), x_align: ActorAlign.CENTER, x_expand: true })

				// pathMenu.actor.add_child(labelFullNameMenuMenu)
				this.pidMenu[key].actor.add_child(this.labelPidMenu[key])
				this.memoryMenu[key].actor.add_child(this.labelMemoryMenuP[key])
				this.pathMenu[key].actor.add_child(this.labelPathMenu[key])
				this.htopMenu[key].actor.add_child(this.labelHtopMenu[key])

				// events
				this.pathMenu[key].connect('activate', () => {
					Clipboard.set_text(CLIPBOARD_TYPE, processName)
				})

				this.htopMenu[key].connect('activate', () => {
					util.spawnApp(['gnome-terminal -x bash -c "htop -p ' + pid + '"'])
				})

				this.genericMenu[key] = new popupMenu.PopupSubMenuMenuItem(realName, true)

				// Build sub-menu processes
				// genericMenu.menu.addMenuItem(fullNameMenu)
				this.genericMenu[key].menu.addMenuItem(this.pidMenu[key])
				this.genericMenu[key].menu.addMenuItem(this.memoryMenu[key])
				this.genericMenu[key].menu.addMenuItem(new popupMenu.PopupSeparatorMenuItem())
				this.genericMenu[key].menu.addMenuItem(this.pathMenu[key])
				this.genericMenu[key].menu.addMenuItem(this.htopMenu[key])

				this.menu.addMenuItem(this.genericMenu[key])
			})
		}

		// Just a static menu with link to github repository
		_onFork() {
			this.menu.addMenuItem(new popupMenu.PopupSeparatorMenuItem())

			this.gitPage = new popupMenu.PopupBaseMenuItem()
			this.gitLabel = new St.Label({ text: _('Fork me on GitHub'), x_align: ActorAlign.CENTER, x_expand: true })

			this.gitPage.actor.add_child(this.gitLabel)
			this.gitPage.connect('activate', function () {
				util.spawn(['xdg-open', 'https://github.com/RuiGuilherme/gnome-shell-extension-nvidia-smi'])
			})
			this.menu.addMenuItem(this.gitPage)
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

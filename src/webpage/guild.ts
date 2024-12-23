import{ Channel }from"./channel.js";
import{ Localuser }from"./localuser.js";
import{ Contextmenu }from"./contextmenu.js";
import{ Role, RoleList }from"./role.js";
import{ Member }from"./member.js";
import{ Dialog, Settings }from"./settings.js";
import{ Permissions }from"./permissions.js";
import{ SnowFlake }from"./snowflake.js";
import{channeljson,guildjson,emojijson,memberjson,invitejson,rolesjson,}from"./jsontypes.js";
import{ User }from"./user.js";
import { I18n } from "./i18n.js";

class Guild extends SnowFlake{
	owner!: Localuser;
	headers!: Localuser["headers"];
	channels!: Channel[];
	properties!: guildjson["properties"];
	member_count!: number;
	roles!: Role[];
	roleids!: Map<string, Role>;
	prevchannel: Channel | undefined;
	banner!: string;
	message_notifications!: number;
	headchannels!: Channel[];
	position!: number;
	parent_id!: string;
	member!: Member;
	html!: HTMLElement;
	emojis!: emojijson[];
	large!: boolean;
	members=new Set<Member>();
	static contextmenu = new Contextmenu<Guild, undefined>("guild menu");
	static setupcontextmenu(){
		Guild.contextmenu.addbutton(()=>I18n.getTranslation("guild.copyId"), function(this: Guild){
			navigator.clipboard.writeText(this.id);
		});

		Guild.contextmenu.addbutton(()=>I18n.getTranslation("guild.markRead"), function(this: Guild){
			this.markAsRead();
		});

		Guild.contextmenu.addbutton(()=>I18n.getTranslation("guild.notifications"), function(this: Guild){
			this.setnotifcation();
		});

		Guild.contextmenu.addbutton(
			()=>I18n.getTranslation("guild.leave"),
			function(this: Guild){
				this.confirmleave();
			},
			null,
			function(_){
				return this.properties.owner_id !== this.member.user.id;
			}
		);

		Guild.contextmenu.addbutton(
			()=>I18n.getTranslation("guild.delete"),
			function(this: Guild){
				this.confirmDelete();
			},
			null,
			function(_){
				return this.properties.owner_id === this.member.user.id;
			}
		);

		Guild.contextmenu.addbutton(
			()=>I18n.getTranslation("guild.makeInvite"),
			function(this: Guild){},
			null,
			_=>true,
			_=>false
		);
		Guild.contextmenu.addbutton(()=>I18n.getTranslation("guild.settings"), function(this: Guild){
			this.generateSettings();
		});
		/* -----things left for later-----
		guild.contextmenu.addbutton("Leave Guild",function(){
		console.log(this)
		this.deleteChannel();
		},null,_=>{return thisuser.isAdmin()})

		guild.contextmenu.addbutton("Mute Guild",function(){
		editchannelf(this);
		},null,_=>{return thisuser.isAdmin()})
		*/
	}
	generateSettings(){
		const settings = new Settings(I18n.getTranslation("guild.settingsFor",this.properties.name));
		{
			const overview = settings.addButton(I18n.getTranslation("guild.overview"));
			const form = overview.addForm("", _=>{}, {
				headers: this.headers,
				traditionalSubmit: true,
				fetchURL: this.info.api + "/guilds/" + this.id,
				method: "PATCH",
			});
			form.addTextInput(I18n.getTranslation("guild.name:"), "name", { initText: this.properties.name });
			form.addMDInput("Description:", "description", {
				initText: this.properties.description,
			});
			form.addFileInput(I18n.getTranslation("guild.banner:"), "banner", { clear: true });
			form.addFileInput(I18n.getTranslation("guild.icon:"), "icon", { clear: true });
			let region = this.properties.region;
			if(!region){
				region = "";
			}
			form.addTextInput(I18n.getTranslation("guild.region:"), "region", { initText: region });
		}
		const s1 = settings.addButton(I18n.getTranslation("guild.roles"));
		const permlist: [Role, Permissions][] = [];
		for(const thing of this.roles){
			permlist.push([thing, thing.permissions]);
		}
		s1.options.push(
			new RoleList(permlist, this, this.updateRolePermissions.bind(this),false)
		);
		settings.show();
	}
	roleUpdate:(role:Role,added:-1|0|1)=>unknown=()=>{};
	sortRoles(){
		this.roles.sort((a,b)=>(b.position-a.position));
	}
	async recalcRoles(){
		let position=this.roles.length;
		const map=this.roles.map(_=>{
			position--;
			return {id:_.id,position};
		})
		await fetch(this.info.api+"/guilds/"+this.id+"/roles",{
			method:"PATCH",
			body:JSON.stringify(map),
			headers:this.headers
		})
	}
	newRole(rolej:rolesjson){
		const role=new Role(rolej,this);
		this.roles.push(role);
		this.roleids.set(role.id, role);
		this.sortRoles();
		this.roleUpdate(role,1);
	}
	updateRole(rolej:rolesjson){
		const role=this.roleids.get(rolej.id) as Role;
		role.newJson(rolej);
		this.roleUpdate(role,0);
	}
	memberupdate(json:memberjson){
		let member:undefined|Member=undefined;
		for(const thing of this.members){
			if(thing.id===json.id){
				member=thing;
				break;
			}
		}

		if(!member) return;
		member.update(json);
		if(member===this.member){
			console.log(member);
			this.loadGuild();
		}
	}
	deleteRole(id:string){
		const role = this.roleids.get(id);
		if(!role) return;
		this.roleids.delete(id);
		this.roles.splice(this.roles.indexOf(role),1);
		this.roleUpdate(role,-1);
	}
	constructor(
		json: guildjson | -1,
		owner: Localuser,
		member: memberjson | User | null
	){
		if(json === -1 || member === null){
			super("@me");
			return;
		}
		if(json.stickers.length){
			console.log(json.stickers, ":3");
		}
		super(json.id);
		this.large = json.large;
		this.member_count = json.member_count;
		this.emojis = json.emojis;
		this.owner = owner;
		this.headers = this.owner.headers;
		this.channels = [];
		this.properties = json.properties;
		this.roles = [];
		this.roleids = new Map();

		this.message_notifications = 0;
		for(const roley of json.roles){
			const roleh = new Role(roley, this);
			this.roles.push(roleh);
			this.roleids.set(roleh.id, roleh);
		}
		this.sortRoles();
		if(member instanceof User){
			console.warn(member);
			Member.resolveMember(member, this).then(_=>{
				if(_){
					this.member = _;
				}else{
					console.error("Member was unable to resolve");
				}
			});
		}else{
			Member.new(member, this).then(_=>{
				if(_){
					this.member = _;
				}
			});
		}
		this.perminfo ??= { channels: {} };
		for(const thing of json.channels){
			const temp = new Channel(thing, this);
			this.channels.push(temp);
			this.localuser.channelids.set(temp.id, temp);
		}
		this.headchannels = [];
		for(const thing of this.channels){
			const parent = thing.resolveparent(this);
			if(!parent){
				this.headchannels.push(thing);
			}
		}
		this.prevchannel = this.localuser.channelids.get(this.perminfo.prevchannel);
	}
	get perminfo(){
		return this.localuser.perminfo.guilds[this.id];
	}
	set perminfo(e){
		this.localuser.perminfo.guilds[this.id] = e;
	}
	notisetting(settings: {
		channel_overrides: {message_notifications: number,muted: boolean,mute_config: {selected_time_window: number,end_time: number},channel_id: string}[];
		message_notifications: any;
		flags?: number;
		hide_muted_channels?: boolean;
		mobile_push?: boolean;
		mute_config?: null;
		mute_scheduled_events?: boolean;
		muted?: boolean;
		notify_highlights?: number;
		suppress_everyone?: boolean;
		suppress_roles?: boolean;
		version?: number;
		guild_id?: string;
		}){
		this.message_notifications = settings.message_notifications;
		for(const override of settings.channel_overrides){
			const channel=this.localuser.channelids.get(override.channel_id);
			if(!channel) continue;
			channel.handleUserOverrides(override);
		}
	}
	setnotifcation(){

		const options=["all", "onlyMentions", "none"].map(e=>I18n.getTranslation("guild."+e));
		const notiselect=new Dialog("");
		const form=notiselect.options.addForm("",(_,sent:any)=>{
			notiselect.hide();
			this.message_notifications = sent.message_notifications;
		},{
			fetchURL:`${this.info.api}/users/@me/guilds/${this.id}/settings/`,
			method:"PATCH",
			headers:this.headers
		});
		form.addSelect(I18n.getTranslation("guild.selectnoti"),"message_notifications",options,{
			radio:true,
			defaultIndex:this.message_notifications
		},[0,1,2]);
		notiselect.show();
	}
	confirmleave(){
		const full = new Dialog("");
		full.options.addTitle(I18n.getTranslation("guild.confirmLeave"))
		const options=full.options.addOptions("",{ltr:true});
		options.addButtonInput("",I18n.getTranslation("guild.yesLeave"),()=>{
			this.leave().then(_=>{
				full.hide();
			});
		});
		options.addButtonInput("",I18n.getTranslation("guild.noLeave"),()=>{
			full.hide();
		});
		full.show();
	}
	async leave(){
		return fetch(this.info.api + "/users/@me/guilds/" + this.id, {
			method: "DELETE",
			headers: this.headers,
		});
	}
	printServers(){
		let build = "";
		for(const thing of this.headchannels){
			build += thing.name + ":" + thing.position + "\n";
			for(const thingy of thing.children){
				build += "   " + thingy.name + ":" + thingy.position + "\n";
			}
		}
		console.log(build);
	}
	calculateReorder(){
		let position = -1;
		const build: {
		id: string;
		position: number | undefined;
		parent_id: string | undefined;
		}[] = [];
		for(const thing of this.headchannels){
			const thisthing: {
		id: string;
		position: number | undefined;
		parent_id: string | undefined;
		} = { id: thing.id, position: undefined, parent_id: undefined };
			if(thing.position <= position){
				thing.position = thisthing.position = position + 1;
			}
			position = thing.position;
			console.log(position);
			if(thing.move_id && thing.move_id !== thing.parent_id){
				thing.parent_id = thing.move_id;
				thisthing.parent_id = thing.parent?.id;
				thing.move_id = undefined;
			}
			if(thisthing.position || thisthing.parent_id){
				build.push(thisthing);
			}
			if(thing.children.length > 0){
				const things = thing.calculateReorder();
				for(const thing of things){
					build.push(thing);
				}
			}
		}
		console.log(build);
		this.printServers();
		if(build.length === 0){
			return;
		}
		const serverbug = false;
		if(serverbug){
			for(const thing of build){
				console.log(build, thing);
				fetch(this.info.api + "/guilds/" + this.id + "/channels", {
					method: "PATCH",
					headers: this.headers,
					body: JSON.stringify([thing]),
				});
			}
		}else{
			fetch(this.info.api + "/guilds/" + this.id + "/channels", {
				method: "PATCH",
				headers: this.headers,
				body: JSON.stringify(build),
			});
		}
	}
	get localuser(){
		return this.owner;
	}
	get info(){
		return this.owner.info;
	}
	sortchannels(){
		this.headchannels.sort((a, b)=>{
			return a.position - b.position;
		});
	}
	static generateGuildIcon(guild: Guild | (invitejson["guild"] & { info: { cdn: string } })){
		const divy = document.createElement("div");
		divy.classList.add("servernoti");

		const noti = document.createElement("div");
		noti.classList.add("unread");
		divy.append(noti);
		if(guild instanceof Guild){
			guild.localuser.guildhtml.set(guild.id, divy);
			guild.html=divy;
		}
		let icon: string | null;
		if(guild instanceof Guild){
			icon = guild.properties.icon;
		}else{
			icon = guild.icon;
		}
		if(icon !== null){
			const img = document.createElement("img");
			img.classList.add("pfp", "servericon");
			img.src = guild.info.cdn + "/icons/" + guild.id + "/" + icon + ".png";
			divy.appendChild(img);
			if(guild instanceof Guild){
				img.onclick = ()=>{
					console.log(guild.loadGuild);
					guild.loadGuild();
					guild.loadChannel();
				};
				Guild.contextmenu.bindContextmenu(img, guild,undefined);
			}
		}else{
			const div = document.createElement("div");
			let name: string;
			if(guild instanceof Guild){
				name = guild.properties.name;
			}else{
				name = guild.name;
			}
			const build = name
				.replace(/'s /g, " ")
				.replace(/\w+/g, word=>word[0])
				.replace(/\s/g, "");
			div.textContent = build;
			div.classList.add("blankserver", "servericon");
			divy.appendChild(div);
			if(guild instanceof Guild){
				div.onclick = ()=>{
					guild.loadGuild();
					guild.loadChannel();
				};
				Guild.contextmenu.bindContextmenu(div, guild,undefined);
			}
		}
		return divy;
	}
	generateGuildIcon(){
		return Guild.generateGuildIcon(this);
	}
	confirmDelete(){
		let confirmname = "";

		const full = new Dialog("");
		full.options.addTitle(I18n.getTranslation("guild.confirmDelete",this.properties.name));
		full.options.addTextInput(I18n.getTranslation("guild.serverName"),()=>{}).onchange=(e)=>confirmname=e;

		const options=full.options.addOptions("",{ltr:true});
		options.addButtonInput("",I18n.getTranslation("guild.yesDelete"),()=>{
			if(confirmname !== this.properties.name){
				//TODO maybe some sort of form error? idk
				alert("names don't match");
				return;
			}
			this.delete().then(_=>{
				full.hide();
			});
		});

		options.addButtonInput("",I18n.getTranslation("guild.noDelete"),()=>{
			full.hide();
		});
		full.show();
	}
	async delete(){
		return fetch(this.info.api + "/guilds/" + this.id + "/delete", {
			method: "POST",
			headers: this.headers,
		});
	}
	unreads(html?: HTMLElement | undefined){
		if(html){
			this.html = html;
		}else{
			html = this.html;
		}
		let read = true;
		for(const thing of this.channels){
			if(thing.hasunreads){
				console.log(thing);
				read = false;
				break;
			}
		}
		if(!html){
			return;
		}
		if(read){
			html.children[0].classList.remove("notiunread");
		}else{
			html.children[0].classList.add("notiunread");
		}
	}
	getHTML(){
		//this.printServers();
		this.sortchannels();
		this.printServers();
		const build = document.createElement("div");

		for(const thing of this.headchannels){
			build.appendChild(thing.createguildHTML(this.isAdmin()));
		}
		return build;
	}
	isAdmin(){
		return this.member.isAdmin();
	}
	async markAsRead(){
		const build: {
		read_states: {
		channel_id: string;
		message_id: string | null | undefined;
		read_state_type: number;
		}[];
		} = { read_states: [] };
		for(const thing of this.channels){
			if(thing.hasunreads){
				build.read_states.push({
					channel_id: thing.id,
					message_id: thing.lastmessageid,
					read_state_type: 0,
				});
				thing.lastreadmessageid = thing.lastmessageid;
				if(!thing.myhtml)continue;
				thing.myhtml.classList.remove("cunread");
			}
		}
		this.unreads();
		fetch(this.info.api + "/read-states/ack-bulk", {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify(build),
		});
	}
	hasRole(r: Role | string){
		console.log("this should run");
		if(r instanceof Role){
			r = r.id;
		}
		return this.member.hasRole(r);
	}
	loadChannel(ID?: string | undefined| null,addstate=true){
		if(ID){
			const channel = this.localuser.channelids.get(ID);
			if(channel){
				channel.getHTML(addstate);
				return;
			}
		}
		if(this.prevchannel&&ID!==null){
			console.log(this.prevchannel);
			this.prevchannel.getHTML(addstate);
			return;
		}
		if(this.id!=="@me"){
			for(const thing of this.channels){
				if(thing.type!==4){
					thing.getHTML(addstate);
					return;
				}
			}
		}
		this.removePrevChannel();
		this.noChannel(addstate);
	}
	removePrevChannel(){
		if(this.localuser.channelfocus){
			this.localuser.channelfocus.infinite.delete();
		}
		if(this !== this.localuser.lookingguild){
			this.loadGuild();
		}
		if(this.localuser.channelfocus && this.localuser.channelfocus.myhtml){
			this.localuser.channelfocus.myhtml.classList.remove("viewChannel");
		}
		this.prevchannel = undefined;
		this.localuser.channelfocus = undefined;
		const replybox = document.getElementById("replybox") as HTMLElement;
		const typebox = document.getElementById("typebox") as HTMLElement;
		replybox.classList.add("hideReplyBox");
		typebox.classList.remove("typeboxreplying");
		(document.getElementById("typebox") as HTMLDivElement).contentEditable ="false";
		(document.getElementById("upload") as HTMLElement).style.visibility="hidden";
		(document.getElementById("typediv") as HTMLElement).style.visibility="hidden";
		(document.getElementById("sideDiv") as HTMLElement).innerHTML="";
	}
	noChannel(addstate:boolean){
		if(addstate){
			history.pushState([this.id,undefined], "", "/channels/" + this.id);
		}
		this.localuser.pageTitle(I18n.getTranslation("guild.emptytitle"));
		const channelTopic = document.getElementById("channelTopic") as HTMLSpanElement;
		channelTopic.setAttribute("hidden", "");

		const loading = document.getElementById("loadingdiv") as HTMLDivElement;
		loading.classList.remove("loading");
		this.localuser.getSidePannel();

		const messages = document.getElementById("channelw") as HTMLDivElement;
		for(const thing of Array.from(messages.getElementsByClassName("messagecontainer"))){
			thing.remove();
		}
		const h1=document.createElement("h1");
		h1.classList.add("messagecontainer")
		h1.textContent=I18n.getTranslation("guild.emptytext");
		messages.append(h1);
	}
	loadGuild(){
		this.localuser.loadGuild(this.id);
	}
	updateChannel(json: channeljson){
		const channel = this.localuser.channelids.get(json.id);
		if(channel){
			channel.updateChannel(json);
			this.headchannels = [];
			for(const thing of this.channels){
				thing.children = [];
			}
			this.headchannels = [];
			for(const thing of this.channels){
				const parent = thing.resolveparent(this);
				if(!parent){
					this.headchannels.push(thing);
				}
			}
			this.printServers();
		}
	}
	createChannelpac(json: channeljson){
		const thischannel = new Channel(json, this);
		this.localuser.channelids.set(json.id, thischannel);
		this.channels.push(thischannel);
		thischannel.resolveparent(this);
		if(!thischannel.parent){
			this.headchannels.push(thischannel);
		}
		this.calculateReorder();
		this.printServers();
		return thischannel;
	}
	createchannels(func = this.createChannel){
		const options=["text", "announcement","voice"].map(e=>I18n.getTranslation("channel."+e));

		const channelselect=new Dialog("");
		const form=channelselect.options.addForm("",(e:any)=>{
			func(e.name,e.type);
			channelselect.hide();
		});

		form.addSelect(I18n.getTranslation("channel.selectType"),"type",options,{radio:true},[0,5,2]);
		form.addTextInput(I18n.getTranslation("channel.selectName"),"name");
		channelselect.show();
	}
	createcategory(){
		const category = 4;
		const channelselect=new Dialog("");
		const options=channelselect.options;
		const form=options.addForm("",(e:any)=>{
			this.createChannel(e.name, category);
			channelselect.hide();
		});
		form.addTextInput(I18n.getTranslation("channel.selectCatName"),"name");
		channelselect.show();
	}
	delChannel(json: channeljson){
		const channel = this.localuser.channelids.get(json.id);
		this.localuser.channelids.delete(json.id);
		if(!channel)return;
		this.channels.splice(this.channels.indexOf(channel), 1);
		const indexy = this.headchannels.indexOf(channel);
		if(indexy !== -1){
			this.headchannels.splice(indexy, 1);
		}
		if(channel===this.prevchannel){
			this.prevchannel=undefined;
		}
		/*
		const build=[];
		for(const thing of this.channels){
		console.log(thing.id);
		if(thing!==channel){
		build.push(thing)
		}else{
		console.log("fail");
		if(thing.parent){
		thing.parent.delChannel(json);
		}
		}
		}
		this.channels=build;
		*/
		this.printServers();
	}
	createChannel(name: string, type: number){
		fetch(this.info.api + "/guilds/" + this.id + "/channels", {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify({ name, type }),
		});
	}
	async createRole(name: string){
		const fetched = await fetch(
			this.info.api + "/guilds/" + this.id + "roles",
			{
				method: "POST",
				headers: this.headers,
				body: JSON.stringify({
					name,
					color: 0,
					permissions: "0",
				}),
			}
		);
		const json = await fetched.json();
		const role = new Role(json, this);
		this.roleids.set(role.id, role);
		this.roles.push(role);
		return role;
	}
	async updateRolePermissions(id: string, perms: Permissions){
		const role = this.roleids.get(id);
		if(!role){
			return;
		}
		role.permissions.allow = perms.allow;
		role.permissions.deny = perms.deny;

		await fetch(this.info.api + "/guilds/" + this.id + "/roles/" + role.id, {
			method: "PATCH",
			headers: this.headers,
			body: JSON.stringify({
				color: role.color,
				hoist: role.hoist,
				icon: role.icon,
				mentionable: role.mentionable,
				name: role.name,
				permissions: role.permissions.allow.toString(),
				unicode_emoji: role.unicode_emoji,
			}),
		});
	}
}
Guild.setupcontextmenu();
export{ Guild };

import{ Guild }from"./guild.js";
import{ Channel }from"./channel.js";
import{ Direct }from"./direct.js";
import{ Voice }from"./audio.js";
import{ User }from"./user.js";
import{ Dialog }from"./dialog.js";
import{ getapiurls, getBulkInfo, setTheme, Specialuser }from"./login.js";
import{
	channeljson,
	guildjson,
	mainuserjson,
	memberjson,
	messageCreateJson,
	presencejson,
	readyjson,
	startTypingjson,
	wsjson,
}from"./jsontypes.js";
import{ Member }from"./member.js";
import{ Form, FormError, Options, Settings }from"./settings.js";
import{ MarkDown }from"./markdown.js";
import { Bot } from "./bot.js";

const wsCodesRetry = new Set([4000, 4003, 4005, 4007, 4008, 4009]);

class Localuser{
	badges: Map<
    string,
    { id: string; description: string; icon: string; link: string }
  > = new Map();
	lastSequence: number | null = null;
	token!: string;
	userinfo!: Specialuser;
	serverurls!: Specialuser["serverurls"];
	initialized!: boolean;
	info!: Specialuser["serverurls"];
	headers!: { "Content-type": string; Authorization: string };
	userConnections!: Dialog;
	devPortal!: Dialog;
	ready!: readyjson;
	guilds!: Guild[];
	guildids: Map<string, Guild> = new Map();
	user!: User;
	status!: string;
	channelfocus: Channel | undefined;
	lookingguild: Guild | undefined;
	guildhtml: Map<string, HTMLDivElement> = new Map();
	ws: WebSocket | undefined;
	connectionSucceed = 0;
	errorBackoff = 0;
	channelids: Map<string, Channel> = new Map();
	readonly userMap: Map<string, User> = new Map();
	instancePing = {
		name: "Unknown",
	};
	mfa_enabled!: boolean;
	get perminfo(){
		return this.userinfo.localuserStore;
	}
	set perminfo(e){
		this.userinfo.localuserStore = e;
	}
	constructor(userinfo: Specialuser | -1){
		if(userinfo === -1){
			return;
		}
		this.token = userinfo.token;
		this.userinfo = userinfo;
		this.perminfo.guilds ??= {};
		this.serverurls = this.userinfo.serverurls;
		this.initialized = false;
		this.info = this.serverurls;
		this.headers = {
			"Content-type": "application/json; charset=UTF-8",
			Authorization: this.userinfo.token,
		};
	}
	gottenReady(ready: readyjson): void{
		this.initialized = true;
		this.ready = ready;
		this.guilds = [];
		this.guildids = new Map();
		this.user = new User(ready.d.user, this);
		this.user.setstatus("online");
		this.mfa_enabled = ready.d.user.mfa_enabled as boolean;
		this.userinfo.username = this.user.username;
		this.userinfo.pfpsrc = this.user.getpfpsrc();
		this.status = this.ready.d.user_settings.status;
		this.channelfocus = undefined;
		this.lookingguild = undefined;
		this.guildhtml = new Map();
		const members: { [key: string]: memberjson } = {};
		for(const thing of ready.d.merged_members){
			members[thing[0].guild_id] = thing[0];
		}

		for(const thing of ready.d.guilds){
			const temp = new Guild(thing, this, members[thing.id]);
			this.guilds.push(temp);
			this.guildids.set(temp.id, temp);
		}
		{
			const temp = new Direct(ready.d.private_channels, this);
			this.guilds.push(temp);
			this.guildids.set(temp.id, temp);
		}
		console.log(ready.d.user_guild_settings.entries);

		for(const thing of ready.d.user_guild_settings.entries){
			(this.guildids.get(thing.guild_id) as Guild).notisetting(thing);
		}

		for(const thing of ready.d.read_state.entries){
			const channel = this.channelids.get(thing.channel_id);
			if(!channel){
				continue;
			}
			channel.readStateInfo(thing);
		}
		for(const thing of ready.d.relationships){
			const user = new User(thing.user, this);
			user.nickname = thing.nickname;
			user.relationshipType = thing.type;
		}

		this.pingEndpoint();
		this.userinfo.updateLocal();
	}
	outoffocus(): void{
		const servers = document.getElementById("servers") as HTMLDivElement;
		servers.innerHTML = "";
		const channels = document.getElementById("channels") as HTMLDivElement;
		channels.innerHTML = "";
		if(this.channelfocus){
			this.channelfocus.infinite.delete();
		}
		this.lookingguild = undefined;
		this.channelfocus = undefined;
	}
	unload(): void{
		this.initialized = false;
		this.outoffocus();
		this.guilds = [];
		this.guildids = new Map();
		if(this.ws){
			this.ws.close(4001);
		}
	}
	swapped = false;
	async initwebsocket(): Promise<void>{
		let returny: () => void;
		const ws = new WebSocket(
			this.serverurls.gateway.toString() +
        "?encoding=json&v=9" +
        (DecompressionStream ? "&compress=zlib-stream" : "")
		);
		this.ws = ws;
		let ds: DecompressionStream;
		let w: WritableStreamDefaultWriter;
		let r: ReadableStreamDefaultReader;
		let arr: Uint8Array;
		let build = "";
		if(DecompressionStream){
			ds = new DecompressionStream("deflate");
			w = ds.writable.getWriter();
			r = ds.readable.getReader();
			arr = new Uint8Array();
		}
		const promise = new Promise<void>(res=>{
			returny = res;
			ws.addEventListener("open", _event=>{
				console.log("WebSocket connected");
				ws.send(
					JSON.stringify({
						op: 2,
						d: {
							token: this.token,
							capabilities: 16381,
							properties: {
								browser: "Jank Client",
								client_build_number: 0, //might update this eventually lol
								release_channel: "Custom",
								browser_user_agent: navigator.userAgent,
							},
							compress: Boolean(DecompressionStream),
							presence: {
								status: "online",
								since: null, //new Date().getTime()
								activities: [],
								afk: false,
							},
						},
					})
				);
			});
			const textdecode = new TextDecoder();
			if(DecompressionStream){
				(async ()=>{
					while(true){
						const read = await r.read();
						const data = textdecode.decode(read.value);
						build += data;
						try{
							const temp = JSON.parse(build);
							build = "";
							if(temp.op === 0 && temp.t === "READY"){
								returny();
							}
							await this.handleEvent(temp);
						}catch{}
					}
				})();
			}
		});

		let order = new Promise<void>(res=>res());

		ws.addEventListener("message", async event=>{
			const temp2 = order;
			order = new Promise<void>(async res=>{
				await temp2;
				let temp: { op: number; t: string };
				try{
					if(event.data instanceof Blob){
						const buff = await event.data.arrayBuffer();
						const array = new Uint8Array(buff);

						const temparr = new Uint8Array(array.length + arr.length);
						temparr.set(arr, 0);
						temparr.set(array, arr.length);
						arr = temparr;

						const len = array.length;
						if(
							!(
								array[len - 1] === 255 &&
                array[len - 2] === 255 &&
                array[len - 3] === 0 &&
                array[len - 4] === 0
							)
						){
							return;
						}
						w.write(arr.buffer);
						arr = new Uint8Array();
						return; //had to move the while loop due to me being dumb
					}else{
						temp = JSON.parse(event.data);
					}
					if(temp.op === 0 && temp.t === "READY"){
						returny();
					}
					await this.handleEvent(temp as readyjson);
				}catch(e){
					console.error(e);
				}finally{
					res();
				}
			});
		});

		ws.addEventListener("close", async event=>{
			this.ws = undefined;
			console.log("WebSocket closed with code " + event.code);

			this.unload();
			(document.getElementById("loading") as HTMLElement).classList.remove(
				"doneloading"
			);
			(document.getElementById("loading") as HTMLElement).classList.add(
				"loading"
			);
			this.fetchingmembers = new Map();
			this.noncemap = new Map();
			this.noncebuild = new Map();
			if(
				(event.code > 1000 && event.code < 1016) ||
        wsCodesRetry.has(event.code)
			){
				if(
					this.connectionSucceed !== 0 &&
          Date.now() > this.connectionSucceed + 20000
				)
					this.errorBackoff = 0;
				else this.errorBackoff++;
				this.connectionSucceed = 0;

				(document.getElementById("load-desc") as HTMLElement).innerHTML =
          "Unable to connect to the Spacebar server, retrying in <b>" +
          Math.round(0.2 + this.errorBackoff * 2.8) +
          "</b> seconds...";
				switch(
					this.errorBackoff //try to recover from bad domain
				){
				case 3:
					const newurls = await getapiurls(this.info.wellknown);
					if(newurls){
						this.info = newurls;
						this.serverurls = newurls;
						this.userinfo.json.serverurls = this.info;
						this.userinfo.updateLocal();
						break;
					}
					break;

				case 4: {
					const newurls = await getapiurls(
						new URL(this.info.wellknown).origin
					);
					if(newurls){
						this.info = newurls;
						this.serverurls = newurls;
						this.userinfo.json.serverurls = this.info;
						this.userinfo.updateLocal();
						break;
					}
					break;
				}
				case 5: {
					const breakappart = new URL(this.info.wellknown).origin.split(".");
					const url =
              "https://" + breakappart.at(-2) + "." + breakappart.at(-1);
					const newurls = await getapiurls(url);
					if(newurls){
						this.info = newurls;
						this.serverurls = newurls;
						this.userinfo.json.serverurls = this.info;
						this.userinfo.updateLocal();
					}
					break;
				}
				}
				setTimeout(()=>{
					if(this.swapped)return;
					(document.getElementById("load-desc") as HTMLElement).textContent =
            "Retrying...";
					this.initwebsocket().then(()=>{
						this.loaduser();
						this.init();
						const loading = document.getElementById("loading") as HTMLElement;
						loading.classList.add("doneloading");
						loading.classList.remove("loading");
						console.log("done loading");
					});
				}, 200 + this.errorBackoff * 2800);
			}else
				(document.getElementById("load-desc") as HTMLElement).textContent =
          "Unable to connect to the Spacebar server. Please try logging out and back in.";
		});

		await promise;
	}
	async handleEvent(temp: wsjson){
		console.debug(temp);
		if(temp.s)this.lastSequence = temp.s;
		if(temp.op == 0){
			switch(temp.t){
			case"MESSAGE_CREATE":
				if(this.initialized){
					this.messageCreate(temp);
				}
				break;
			case"MESSAGE_DELETE": {
				temp.d.guild_id ??= "@me";
				const channel = this.channelids.get(temp.d.channel_id);
				if(!channel)break;
				const message = channel.messages.get(temp.d.id);
				if(!message)break;
				message.deleteEvent();
				break;
			}
			case"READY":
				this.gottenReady(temp as readyjson);
				break;
			case"MESSAGE_UPDATE": {
				temp.d.guild_id ??= "@me";
				const channel = this.channelids.get(temp.d.channel_id);
				if(!channel)break;
				const message = channel.messages.get(temp.d.id);
				if(!message)break;
				message.giveData(temp.d);
				break;
			}
			case"TYPING_START":
				if(this.initialized){
					this.typingStart(temp);
				}
				break;
			case"USER_UPDATE":
				if(this.initialized){
					const users = this.userMap.get(temp.d.id);
					if(users){
						users.userupdate(temp.d);
					}
				}
				break;
			case"CHANNEL_UPDATE":
				if(this.initialized){
					this.updateChannel(temp.d);
				}
				break;
			case"CHANNEL_CREATE":
				if(this.initialized){
					this.createChannel(temp.d);
				}
				break;
			case"CHANNEL_DELETE":
				if(this.initialized){
					this.delChannel(temp.d);
				}
				break;
			case"GUILD_DELETE": {
				const guildy = this.guildids.get(temp.d.id);
				if(guildy){
					this.guildids.delete(temp.d.id);
					this.guilds.splice(this.guilds.indexOf(guildy), 1);
					guildy.html.remove();
				}
				break;
			}
			case"GUILD_CREATE": {
				const guildy = new Guild(temp.d, this, this.user);
				this.guilds.push(guildy);
				this.guildids.set(guildy.id, guildy);
				(document.getElementById("servers") as HTMLDivElement).insertBefore(
					guildy.generateGuildIcon(),
					document.getElementById("bottomseparator")
				);
				break;
			}
			case"MESSAGE_REACTION_ADD":
				{
					temp.d.guild_id ??= "@me";
					const guild = this.guildids.get(temp.d.guild_id);
					if(!guild)break;
					const channel = this.channelids.get(temp.d.channel_id);
					if(!channel)break;
					const message = channel.messages.get(temp.d.message_id);
					if(!message)break;
					let thing: Member | { id: string };
					if(temp.d.member){
						thing = (await Member.new(temp.d.member, guild)) as Member;
					}else{
						thing = { id: temp.d.user_id };
					}
					message.reactionAdd(temp.d.emoji, thing);
				}
				break;
			case"MESSAGE_REACTION_REMOVE":
				{
					temp.d.guild_id ??= "@me";
					const channel = this.channelids.get(temp.d.channel_id);
					if(!channel)break;
					const message = channel.messages.get(temp.d.message_id);
					if(!message)break;
					message.reactionRemove(temp.d.emoji, temp.d.user_id);
				}
				break;
			case"MESSAGE_REACTION_REMOVE_ALL":
				{
					temp.d.guild_id ??= "@me";
					const channel = this.channelids.get(temp.d.channel_id);
					if(!channel)break;
					const message = channel.messages.get(temp.d.message_id);
					if(!message)break;
					message.reactionRemoveAll();
				}
				break;
			case"MESSAGE_REACTION_REMOVE_EMOJI":
				{
					temp.d.guild_id ??= "@me";
					const channel = this.channelids.get(temp.d.channel_id);
					if(!channel)break;
					const message = channel.messages.get(temp.d.message_id);
					if(!message)break;
					message.reactionRemoveEmoji(temp.d.emoji);
				}
				break;
			case"GUILD_MEMBERS_CHUNK":
				this.gotChunk(temp.d);
				break;
			}
		}else if(temp.op === 10){
			if(!this.ws)return;
			console.log("heartbeat down");
			this.heartbeat_interval = temp.d.heartbeat_interval;
			this.ws.send(JSON.stringify({ op: 1, d: this.lastSequence }));
		}else if(temp.op === 11){
			setTimeout((_: any)=>{
				if(!this.ws)return;
				if(this.connectionSucceed === 0)this.connectionSucceed = Date.now();
				this.ws.send(JSON.stringify({ op: 1, d: this.lastSequence }));
			}, this.heartbeat_interval);
		}
	}
	heartbeat_interval: number = 0;
	updateChannel(json: channeljson): void{
		const guild = this.guildids.get(json.guild_id);
		if(guild){
			guild.updateChannel(json);
			if(json.guild_id === this.lookingguild?.id){
				this.loadGuild(json.guild_id);
			}
		}
	}
	createChannel(json: channeljson): undefined | Channel{
		json.guild_id ??= "@me";
		const guild = this.guildids.get(json.guild_id);
		if(!guild)return;
		const channel = guild.createChannelpac(json);
		if(json.guild_id === this.lookingguild?.id){
			this.loadGuild(json.guild_id);
		}
		if(channel.id === this.gotoid){
			guild.loadGuild();
			guild.loadChannel(channel.id);
			this.gotoid = undefined;
		}
		return channel; // Add this line to return the 'channel' variable
	}
	gotoid: string | undefined;
	async goToChannel(id: string){
		const channel = this.channelids.get(id);
		if(channel){
			const guild = channel.guild;
			guild.loadGuild();
			guild.loadChannel(id);
		}else{
			this.gotoid = id;
		}
	}
	delChannel(json: channeljson): void{
		let guild_id = json.guild_id;
		guild_id ??= "@me";
		const guild = this.guildids.get(guild_id);
		if(guild){
			guild.delChannel(json);
		}

		if(json.guild_id === this.lookingguild?.id){
			this.loadGuild(json.guild_id);
		}
	}
	init(): void{
		const location = window.location.href.split("/");
		this.buildservers();
		if(location[3] === "channels"){
			const guild = this.loadGuild(location[4]);
			if(!guild){
				return;
			}
			guild.loadChannel(location[5]);
			this.channelfocus = this.channelids.get(location[5]);
		}
	}
	loaduser(): void{
		(document.getElementById("username") as HTMLSpanElement).textContent =
      this.user.username;
		(document.getElementById("userpfp") as HTMLImageElement).src =
      this.user.getpfpsrc();
		(document.getElementById("status") as HTMLSpanElement).textContent =
      this.status;
	}
	isAdmin(): boolean{
		if(this.lookingguild){
			return this.lookingguild.isAdmin();
		}else{
			return false;
		}
	}
	loadGuild(id: string): Guild | undefined{
		let guild = this.guildids.get(id);
		if(!guild){
			guild = this.guildids.get("@me");
		}
		if(this.lookingguild === guild){
			return guild;
		}
		if(this.channelfocus){
			this.channelfocus.infinite.delete();
			this.channelfocus = undefined;
		}
		if(this.lookingguild){
			this.lookingguild.html.classList.remove("serveropen");
		}

		if(!guild)return;
		if(guild.html){
			guild.html.classList.add("serveropen");
		}
		this.lookingguild = guild;
		(document.getElementById("serverName") as HTMLElement).textContent =
      guild.properties.name;
		//console.log(this.guildids,id)
		const channels = document.getElementById("channels") as HTMLDivElement;
		channels.innerHTML = "";
		const html = guild.getHTML();
		channels.appendChild(html);
		return guild;
	}
	buildservers(): void{
		const serverlist = document.getElementById("servers") as HTMLDivElement; //
		const outdiv = document.createElement("div");
		const home: any = document.createElement("span");
		const div = document.createElement("div");
		div.classList.add("home", "servericon");

		home.classList.add("svgtheme", "svgicon", "svg-home");
		home.all = this.guildids.get("@me");
		(this.guildids.get("@me") as Guild).html = outdiv;
		const unread = document.createElement("div");
		unread.classList.add("unread");
		outdiv.append(unread);
		outdiv.append(div);
		div.appendChild(home);

		outdiv.classList.add("servernoti");
		serverlist.append(outdiv);
		home.onclick = function(){
			this.all.loadGuild();
			this.all.loadChannel();
		};
		const sentdms = document.createElement("div");
		sentdms.classList.add("sentdms");
		serverlist.append(sentdms);
		sentdms.id = "sentdms";

		const br = document.createElement("hr");
		br.classList.add("lightbr");
		serverlist.appendChild(br);
		for(const thing of this.guilds){
			if(thing instanceof Direct){
				(thing as Direct).unreaddms();
				continue;
			}
			const divy = thing.generateGuildIcon();
			serverlist.append(divy);
		}
		{
			const br = document.createElement("hr");
			br.classList.add("lightbr");
			serverlist.appendChild(br);
			br.id = "bottomseparator";

			const div = document.createElement("div");
			div.textContent = "+";
			div.classList.add("home", "servericon");
			serverlist.appendChild(div);
			div.onclick = _=>{
				this.createGuild();
			};
			const guilddsdiv = document.createElement("div");
			const guildDiscoveryContainer = document.createElement("span");
			guildDiscoveryContainer.classList.add(
				"svgtheme",
				"svgicon",
				"svg-explore"
			);
			guilddsdiv.classList.add("home", "servericon");
			guilddsdiv.appendChild(guildDiscoveryContainer);
			serverlist.appendChild(guilddsdiv);
			guildDiscoveryContainer.addEventListener("click", ()=>{
				this.guildDiscovery();
			});
		}
		this.unreads();
	}
	createGuild(){
		let inviteurl = "";
		const error = document.createElement("span");
		const fields: { name: string; icon: string | null } = {
			name: "",
			icon: null,
		};
		const full = new Dialog([
			"tabs",
			[
				[
					"Join using invite",
					[
						"vdiv",
						[
							"textbox",
							"Invite Link/Code",
							"",
							function(this: HTMLInputElement){
								inviteurl = this.value;
							},
						],
						["html", error],
						[
							"button",
							"",
							"Submit",
							(_: any)=>{
								let parsed = "";
								if(inviteurl.includes("/")){
									parsed =
                    inviteurl.split("/")[inviteurl.split("/").length - 1];
								}else{
									parsed = inviteurl;
								}
								fetch(this.info.api + "/invites/" + parsed, {
									method: "POST",
									headers: this.headers,
								})
									.then(r=>r.json())
									.then(_=>{
										if(_.message){
											error.textContent = _.message;
										}
									});
							},
						],
					],
				],
				[
					"Create Guild",
					[
						"vdiv",
						["title", "Create a guild"],
						[
							"fileupload",
							"Icon:",
							function(event: Event){
								const target = event.target as HTMLInputElement;
								if(!target.files)return;
								const reader = new FileReader();
								reader.readAsDataURL(target.files[0]);
								reader.onload = ()=>{
									fields.icon = reader.result as string;
								};
							},
						],
						[
							"textbox",
							"Name:",
							"",
							function(this: HTMLInputElement, event: Event){
								const target = event.target as HTMLInputElement;
								fields.name = target.value;
							},
						],
						[
							"button",
							"",
							"submit",
							()=>{
								this.makeGuild(fields).then(_=>{
									if(_.message){
										alert(_.errors.name._errors[0].message);
									}else{
										full.hide();
									}
								});
							},
						],
					],
				],
			],
		]);
		full.show();
	}
	async makeGuild(fields: { name: string; icon: string | null }){
		return await (
			await fetch(this.info.api + "/guilds", {
				method: "POST",
				headers: this.headers,
				body: JSON.stringify(fields),
			})
		).json();
	}
	async guildDiscovery(){
		const content = document.createElement("div");
		content.classList.add("guildy");
		content.textContent = "Loading...";
		const full = new Dialog(["html", content]);
		full.show();

		const res = await fetch(this.info.api + "/discoverable-guilds?limit=50", {
			headers: this.headers,
		});
		const json = await res.json();

		content.innerHTML = "";
		const title = document.createElement("h2");
		title.textContent = "Guild discovery (" + json.total + " entries)";
		content.appendChild(title);

		const guilds = document.createElement("div");
		guilds.id = "discovery-guild-content";

		json.guilds.forEach((guild: guildjson["properties"])=>{
			const content = document.createElement("div");
			content.classList.add("discovery-guild");

			if(guild.banner){
				const banner = document.createElement("img");
				banner.classList.add("banner");
				banner.crossOrigin = "anonymous";
				banner.src =
          this.info.cdn +
          "/icons/" +
          guild.id +
          "/" +
          guild.banner +
          ".png?size=256";
				banner.alt = "";
				content.appendChild(banner);
			}

			const nameContainer = document.createElement("div");
			nameContainer.classList.add("flex");
			const img = document.createElement("img");
			img.classList.add("icon");
			img.crossOrigin = "anonymous";
			img.src =
        this.info.cdn +
        (guild.icon
        	? "/icons/" + guild.id + "/" + guild.icon + ".png?size=48"
        	: "/embed/avatars/3.png");
			img.alt = "";
			nameContainer.appendChild(img);

			const name = document.createElement("h3");
			name.textContent = guild.name;
			nameContainer.appendChild(name);
			content.appendChild(nameContainer);
			const desc = document.createElement("p");
			desc.textContent = guild.description;
			content.appendChild(desc);

			content.addEventListener("click", async ()=>{
				const joinRes = await fetch(
					this.info.api + "/guilds/" + guild.id + "/members/@me",
					{
						method: "PUT",
						headers: this.headers,
					}
				);
				if(joinRes.ok) full.hide();
			});
			guilds.appendChild(content);
		});
		content.appendChild(guilds);
	}
	messageCreate(messagep: messageCreateJson): void{
		messagep.d.guild_id ??= "@me";
		const channel = this.channelids.get(messagep.d.channel_id);
		if(channel){
			channel.messageCreate(messagep);
			this.unreads();
		}
	}
	unreads(): void{
		for(const thing of this.guilds){
			if(thing.id === "@me"){
				continue;
			}
			const html = this.guildhtml.get(thing.id);
			thing.unreads(html);
		}
	}
	async typingStart(typing: startTypingjson): Promise<void>{
		const channel = this.channelids.get(typing.d.channel_id);
		if(!channel)return;
		channel.typingStart(typing);
	}
	updatepfp(file: Blob): void{
		const reader = new FileReader();
		reader.readAsDataURL(file);
		reader.onload = ()=>{
			fetch(this.info.api + "/users/@me", {
				method: "PATCH",
				headers: this.headers,
				body: JSON.stringify({
					avatar: reader.result,
				}),
			});
		};
	}
	updatebanner(file: Blob | null): void{
		if(file){
			const reader = new FileReader();
			reader.readAsDataURL(file);
			reader.onload = ()=>{
				fetch(this.info.api + "/users/@me", {
					method: "PATCH",
					headers: this.headers,
					body: JSON.stringify({
						banner: reader.result,
					}),
				});
			};
		}else{
			fetch(this.info.api + "/users/@me", {
				method: "PATCH",
				headers: this.headers,
				body: JSON.stringify({
					banner: null,
				}),
			});
		}
	}
	updateProfile(json: {
    bio?: string;
    pronouns?: string;
    accent_color?: number;
  }){
		fetch(this.info.api + "/users/@me/profile", {
			method: "PATCH",
			headers: this.headers,
			body: JSON.stringify(json),
		});
	}
	async showusersettings(){
		const settings = new Settings("Settings");
		{
			const userOptions = settings.addButton("User Settings", { ltr: true });
			const hypotheticalProfile = document.createElement("div");
			let file: undefined | File | null;
			let newpronouns: string | undefined;
			let newbio: string | undefined;
			const hypouser = this.user.clone();
			let color: string;
			async function regen(){
				hypotheticalProfile.textContent = "";
				const hypoprofile = await hypouser.buildprofile(-1, -1);

				hypotheticalProfile.appendChild(hypoprofile);
			}
			regen();
			const settingsLeft = userOptions.addOptions("");
			const settingsRight = userOptions.addOptions("");
			settingsRight.addHTMLArea(hypotheticalProfile);

			const finput = settingsLeft.addFileInput(
				"Upload pfp:",
				_=>{
					if(file){
						this.updatepfp(file);
					}
				},
				{ clear: true }
			);
			finput.watchForChange(_=>{
				if(!_){
					file = null;
					hypouser.avatar = null;
					hypouser.hypotheticalpfp = true;
					regen();
					return;
				}
				if(_.length){
					file = _[0];
					const blob = URL.createObjectURL(file);
					hypouser.avatar = blob;
					hypouser.hypotheticalpfp = true;
					regen();
				}
			});
			let bfile: undefined | File | null;
			const binput = settingsLeft.addFileInput(
				"Upload banner:",
				_=>{
					if(bfile !== undefined){
						this.updatebanner(bfile);
					}
				},
				{ clear: true }
			);
			binput.watchForChange(_=>{
				if(!_){
					bfile = null;
					hypouser.banner = undefined;
					hypouser.hypotheticalbanner = true;
					regen();
					return;
				}
				if(_.length){
					bfile = _[0];
					const blob = URL.createObjectURL(bfile);
					hypouser.banner = blob;
					hypouser.hypotheticalbanner = true;
					regen();
				}
			});
			let changed = false;
			const pronounbox = settingsLeft.addTextInput(
				"Pronouns",
				_=>{
					if(newpronouns || newbio || changed){
						this.updateProfile({
							pronouns: newpronouns,
							bio: newbio,
							accent_color: Number.parseInt("0x" + color.substr(1), 16),
						});
					}
				},
				{ initText: this.user.pronouns }
			);
			pronounbox.watchForChange(_=>{
				hypouser.pronouns = _;
				newpronouns = _;
				regen();
			});
			const bioBox = settingsLeft.addMDInput("Bio:", _=>{}, {
				initText: this.user.bio.rawString,
			});
			bioBox.watchForChange(_=>{
				newbio = _;
				hypouser.bio = new MarkDown(_, this);
				regen();
			});

			if(this.user.accent_color){
				color = "#" + this.user.accent_color.toString(16);
			}else{
				color = "transparent";
			}
			const colorPicker = settingsLeft.addColorInput(
				"Profile color",
				_=>{},
				{ initColor: color }
			);
			colorPicker.watchForChange(_=>{
				console.log();
				color = _;
				hypouser.accent_color = Number.parseInt("0x" + _.substr(1), 16);
				changed = true;
				regen();
			});
		}
		{
			const tas = settings.addButton("Themes & sounds");
			{
				const themes = ["Dark", "WHITE", "Light"];
				tas.addSelect(
					"Theme:",
					_=>{
						localStorage.setItem("theme", themes[_]);
						setTheme();
					},
					themes,
					{
						defaultIndex: themes.indexOf(
              localStorage.getItem("theme") as string
						),
					}
				);
			}
			{
				const sounds = Voice.sounds;
				tas
					.addSelect(
						"Notification sound:",
						_=>{
							Voice.setNotificationSound(sounds[_]);
						},
						sounds,
						{ defaultIndex: sounds.indexOf(Voice.getNotificationSound()) }
					)
					.watchForChange(_=>{
						Voice.noises(sounds[_]);
					});
			}

			{
				const userinfos = getBulkInfo();
				tas.addColorInput(
					"Accent color:",
					_=>{
						userinfos.accent_color = _;
						localStorage.setItem("userinfos", JSON.stringify(userinfos));
						document.documentElement.style.setProperty(
							"--accent-color",
							userinfos.accent_color
						);
					},
					{ initColor: userinfos.accent_color }
				);
			}
		}
		{
			const security = settings.addButton("Account Settings");
			const genSecurity = ()=>{
				security.removeAll();
				if(this.mfa_enabled){
					security.addButtonInput("", "Disable 2FA", ()=>{
						const form = security.addSubForm(
							"2FA Disable",
							(_: any)=>{
								if(_.message){
									switch(_.code){
									case 60008:
										form.error("code", "Invalid code");
										break;
									}
								}else{
									this.mfa_enabled = false;
									security.returnFromSub();
									genSecurity();
								}
							},
							{
								fetchURL: this.info.api + "/users/@me/mfa/totp/disable",
								headers: this.headers,
							}
						);
						form.addTextInput("Code:", "code", { required: true });
					});
				}else{
					security.addButtonInput("", "Enable 2FA", async ()=>{
						let secret = "";
						for(let i = 0; i < 18; i++){
							secret += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[
								Math.floor(Math.random() * 32)
							];
						}
						const form = security.addSubForm(
							"2FA Setup",
							(_: any)=>{
								if(_.message){
									switch(_.code){
									case 60008:
										form.error("code", "Invalid code");
										break;
									case 400:
										form.error("password", "Incorrect password");
										break;
									}
								}else{
									genSecurity();
									this.mfa_enabled = true;
									security.returnFromSub();
								}
							},
							{
								fetchURL: this.info.api + "/users/@me/mfa/totp/enable/",
								headers: this.headers,
							}
						);
						form.addTitle(
							"Copy this secret into your totp(time-based one time password) app"
						);
						form.addText(
							`Your secret is: ${secret} and it's 6 digits, with a 30 second token period`
						);
						form.addTextInput("Account Password:", "password", {
							required: true,
							password: true,
						});
						form.addTextInput("Code:", "code", { required: true });
						form.setValue("secret", secret);
					});
				}
				security.addButtonInput("", "Change discriminator", ()=>{
					const form = security.addSubForm(
						"Change Discriminator",
						_=>{
							security.returnFromSub();
						},
						{
							fetchURL: this.info.api + "/users/@me/",
							headers: this.headers,
							method: "PATCH",
						}
					);
					form.addTextInput("New discriminator:", "discriminator");
				});
				security.addButtonInput("", "Change email", ()=>{
					const form = security.addSubForm(
						"Change Email",
						_=>{
							security.returnFromSub();
						},
						{
							fetchURL: this.info.api + "/users/@me/",
							headers: this.headers,
							method: "PATCH",
						}
					);
					form.addTextInput("Password:", "password", { password: true });
					if(this.mfa_enabled){
						form.addTextInput("Code:", "code");
					}
					form.addTextInput("New email:", "email");
				});
				security.addButtonInput("", "Change username", ()=>{
					const form = security.addSubForm(
						"Change Username",
						_=>{
							security.returnFromSub();
						},
						{
							fetchURL: this.info.api + "/users/@me/",
							headers: this.headers,
							method: "PATCH",
						}
					);
					form.addTextInput("Password:", "password", { password: true });
					if(this.mfa_enabled){
						form.addTextInput("Code:", "code");
					}
					form.addTextInput("New username:", "username");
				});
				security.addButtonInput("", "Change password", ()=>{
					const form = security.addSubForm(
						"Change Password",
						_=>{
							security.returnFromSub();
						},
						{
							fetchURL: this.info.api + "/users/@me/",
							headers: this.headers,
							method: "PATCH",
						}
					);
					form.addTextInput("Old password:", "password", { password: true });
					if(this.mfa_enabled){
						form.addTextInput("Code:", "code");
					}
					let in1 = "";
					let in2 = "";
					form.addTextInput("New password:", "").watchForChange(text=>{
						in1 = text;
					});
					const copy = form.addTextInput("New password again:", "");
					copy.watchForChange(text=>{
						in2 = text;
					});
					form.setValue("new_password", ()=>{
						if(in1 === in2){
							return in1;
						}else{
							throw new FormError(copy, "Passwords don't match");
						}
					});
				});
			};
			genSecurity();
		}
		{
			const connections = settings.addButton("Connections");
			const connectionContainer = document.createElement("div");
			connectionContainer.id = "connection-container";

			fetch(this.info.api + "/connections", {
				headers: this.headers,
			})
				.then(r=>r.json())
				.then(json=>{
					Object.keys(json)
						.sort(key=>(json[key].enabled ? -1 : 1))
						.forEach(key=>{
							const connection = json[key];

							const container = document.createElement("div");
							container.textContent =
                key.charAt(0).toUpperCase() + key.slice(1);

							if(connection.enabled){
								container.addEventListener("click", async ()=>{
									const connectionRes = await fetch(
										this.info.api + "/connections/" + key + "/authorize",
										{
											headers: this.headers,
										}
									);
									const connectionJSON = await connectionRes.json();
									window.open(
										connectionJSON.url,
										"_blank",
										"noopener noreferrer"
									);
								});
							}else{
								container.classList.add("disabled");
								container.title =
                  "This connection has been disabled server-side.";
							}

							connectionContainer.appendChild(container);
						});
				});
			connections.addHTMLArea(connectionContainer);
		}
		{
			const devPortal = settings.addButton("Developer Portal");

			fetch(this.info.api + "/teams", {
				headers: this.headers,
			}).then(async (teamsRes)=>{
				const teams = await teamsRes.json();

				devPortal.addButtonInput("", "Create application", ()=>{
					const form = devPortal.addSubForm(
						"Create application",
						(json: any)=>{
							if(json.message) form.error("name", json.message);
							else{
								devPortal.returnFromSub();
								this.manageApplication(json.id,devPortal);
							}
						},
						{
							fetchURL: this.info.api + "/applications",
							headers: this.headers,
							method: "POST",
						}
					);

					form.addTextInput("Name", "name", { required: true });
					form.addSelect(
						"Team",
						"team_id",
						["Personal", ...teams.map((team: { name: string })=>team.name)],
						{
							defaultIndex: 0,
						}
					);
				});

				const appListContainer = document.createElement("div");
				appListContainer.id = "app-list-container";
				fetch(this.info.api + "/applications", {
					headers: this.headers,
				})
					.then(r=>r.json())
					.then(json=>{
						json.forEach(
							(application: {
								cover_image: any;
								icon: any;
								id: string | undefined;
								name: string | number;
								bot: any;
							})=>{
								const container = document.createElement("div");

								if(application.cover_image || application.icon){
									const cover = document.createElement("img");
									cover.crossOrigin = "anonymous";
									cover.src =
									this.info.cdn +
									"/app-icons/" +
									application.id +
									"/" +
									(application.cover_image || application.icon) +
									".png?size=256";
									cover.alt = "";
									cover.loading = "lazy";
									container.appendChild(cover);
								}

								const name = document.createElement("h2");
								name.textContent = application.name + (application.bot ? " (Bot)" : "");
								container.appendChild(name);

								container.addEventListener("click", async ()=>{
									this.manageApplication(application.id,devPortal);
								});
								appListContainer.appendChild(container);
							}
						);
					});
				devPortal.addHTMLArea(appListContainer);
			});
		}
		settings.show();
	}
	readonly botTokens:Map<string,string>=new Map();
	async manageApplication(appId = "", container:Options){
		if(this.perminfo.applications){
			for(const item of Object.keys(this.perminfo.applications)){
				this.botTokens.set(item,this.perminfo.applications[item]);
			}
		}
		const res = await fetch(this.info.api + "/applications/" + appId, {
			headers: this.headers,
		});
		const json = await res.json();
		const form=container.addSubForm(json.name,()=>{},{
			fetchURL:this.info.api + "/applications/" + appId,
			method:"PATCH",
			headers:this.headers,
			traditionalSubmit:true
		});
		form.addTextInput("Application name:","name",{initText:json.name});
		form.addMDInput("Description:","description",{initText:json.description});
		form.addFileInput("Icon:","icon");
		form.addTextInput("Privacy policy URL:","privacy_policy_url",{initText:json.privacy_policy_url});
		form.addTextInput("Terms of Service URL:","terms_of_service_url",{initText:json.terms_of_service_url});
		form.addCheckboxInput("Make bot publicly inviteable?","bot_public",{initState:json.bot_public});
		form.addCheckboxInput("Require code grant to invite the bot?","bot_require_code_grant",{initState:json.bot_require_code_grant});
		form.addButtonInput("",(json.bot ? "Manage" : "Add")+" bot",async ()=>{
			if(!json.bot){
				if(!confirm("Are you sure you want to add a bot to this application? There's no going back.")){
					return;
				}
				const updateRes = await fetch(
					this.info.api + "/applications/" + appId + "/bot",
					{
						method: "POST",
						headers: this.headers,
					}
				);
				const updateJSON = await updateRes.json();
				this.botTokens.set(appId,updateJSON.token);
			}
			this.manageBot(appId,form);
		})
	}
	async manageBot(appId = "",container:Form){
		const res = await fetch(this.info.api + "/applications/" + appId, {
			headers: this.headers
		});
		const json = await res.json();
		if(!json.bot){
			return alert("For some reason, this application doesn't have a bot (yet).");
		}
		const bot:mainuserjson=json.bot;
		const form=container.addSubForm("Editing bot "+bot.username,out=>{console.log(out)},{
			method:"PATCH",
			fetchURL:this.info.api + "/applications/" + appId + "/bot",
			headers:this.headers,
			traditionalSubmit:true
		});
		form.addTextInput("Bot username:","username",{initText:bot.username});
		form.addFileInput("Bot avatar:","avatar");
		form.addButtonInput("Reset Token:","Reset",async ()=>{
			if(!confirm("Are you sure you want to reset the bot token? Your bot will stop working until you update it.")){
				return;
			}
			const updateRes = await fetch(
				this.info.api + "/applications/" + appId + "/bot/reset",
				{
					method: "POST",
					headers: this.headers,
				}
			);
			const updateJSON = await updateRes.json();
			text.setText("Token: "+updateJSON.token);
			this.botTokens.set(appId,updateJSON.token);
			if(this.perminfo.applications[appId]){
				this.perminfo.applications[appId]=updateJSON.token;
				this.userinfo.updateLocal();
			}
		});
		const text=form.addText(this.botTokens.has(appId)?"Token: "+this.botTokens.get(appId):"Token: *****************");
		const check=form.addOptions("",{noSubmit:true});
		if(!this.perminfo.applications){
			this.perminfo.applications={};
			this.userinfo.updateLocal();
		}
		const checkbox=check.addCheckboxInput("Save token to localStorage",()=>{},{initState:!!this.perminfo.applications[appId]});
		checkbox.watchForChange(_=>{
			if(_){
				if(this.botTokens.has(appId)){
					this.perminfo.applications[appId]=this.botTokens.get(appId);
					this.userinfo.updateLocal();
				}else{
					alert("Don't know token so can't save it to localStorage, sorry");
					checkbox.setState(false);
				}
			}else{
				delete this.perminfo.applications[appId];
				this.userinfo.updateLocal();
			}
		});
		form.addButtonInput("","Advanced bot settings",()=>{
			const token=this.botTokens.get(appId);
			if(token){
				const botc=new Bot(bot,token,this);
				botc.settings();
			}
		});
		form.addButtonInput("","Bot Invite Creator",()=>{
			Bot.InviteMaker(appId,form,this.info);
		})
	}
	//---------- resolving members code -----------
	readonly waitingmembers: Map<
    string,
    Map<string, (returns: memberjson | undefined) => void>
  > = new Map();
	readonly presences: Map<string, presencejson> = new Map();
	async resolvemember(
		id: string,
		guildid: string
	): Promise<memberjson | undefined>{
		if(guildid === "@me"){
			return undefined;
		}
		const guild = this.guildids.get(guildid);
		const borked = true;
		if(borked && guild && guild.member_count > 250){
			//sorry puyo, I need to fix member resolving while it's broken on large guilds
			try{
				const req = await fetch(
					this.info.api + "/guilds/" + guild.id + "/members/" + id,
					{
						headers: this.headers,
					}
				);
				if(req.status !== 200){
					return undefined;
				}
				return await req.json();
			}catch{
				return undefined;
			}
		}
		let guildmap = this.waitingmembers.get(guildid);
		if(!guildmap){
			guildmap = new Map();
			this.waitingmembers.set(guildid, guildmap);
		}
		const promise: Promise<memberjson | undefined> = new Promise(res=>{
			guildmap.set(id, res);
			this.getmembers();
		});
		return await promise;
	}
	fetchingmembers: Map<string, boolean> = new Map();
	noncemap: Map<string, (r: [memberjson[], string[]]) => void> = new Map();
	noncebuild: Map<string, [memberjson[], string[], number[]]> = new Map();
	async gotChunk(chunk: {
    chunk_index: number;
    chunk_count: number;
    nonce: string;
    not_found?: string[];
    members?: memberjson[];
    presences: presencejson[];
  }){
		for(const thing of chunk.presences){
			if(thing.user){
				this.presences.set(thing.user.id, thing);
			}
		}
		chunk.members ??= [];
		const arr = this.noncebuild.get(chunk.nonce);
		if(!arr)return;
		arr[0] = arr[0].concat(chunk.members);
		if(chunk.not_found){
			arr[1] = chunk.not_found;
		}
		arr[2].push(chunk.chunk_index);
		if(arr[2].length === chunk.chunk_count){
			this.noncebuild.delete(chunk.nonce);
			const func = this.noncemap.get(chunk.nonce);
			if(!func)return;
			func([arr[0], arr[1]]);
			this.noncemap.delete(chunk.nonce);
		}
	}
	async getmembers(){
		const promise = new Promise(res=>{
			setTimeout(res, 10);
		});
		await promise; //allow for more to be sent at once :P
		if(this.ws){
			this.waitingmembers.forEach(async (value, guildid)=>{
				const keys = value.keys();
				if(this.fetchingmembers.has(guildid)){
					return;
				}
				const build: string[] = [];
				for(const key of keys){
					build.push(key);
					if(build.length === 100){
						break;
					}
				}
				if(!build.length){
					this.waitingmembers.delete(guildid);
					return;
				}
				const promise: Promise<[memberjson[], string[]]> = new Promise(
					res=>{
						const nonce = "" + Math.floor(Math.random() * 100000000000);
						this.noncemap.set(nonce, res);
						this.noncebuild.set(nonce, [[], [], []]);
						if(!this.ws)return;
						this.ws.send(
							JSON.stringify({
								op: 8,
								d: {
									user_ids: build,
									guild_id: guildid,
									limit: 100,
									nonce,
									presences: true,
								},
							})
						);
						this.fetchingmembers.set(guildid, true);
					}
				);
				const prom = await promise;
				const data = prom[0];
				for(const thing of data){
					if(value.has(thing.id)){
						const func = value.get(thing.id);
						if(!func){
							value.delete(thing.id);
							continue;
						}
						func(thing);
						value.delete(thing.id);
					}
				}
				for(const thing of prom[1]){
					if(value.has(thing)){
						const func = value.get(thing);
						if(!func){
							value.delete(thing);
							continue;
						}
						func(undefined);
						value.delete(thing);
					}
				}
				this.fetchingmembers.delete(guildid);
				this.getmembers();
			});
		}
	}
	async pingEndpoint(){
		const userInfo = getBulkInfo();
		if(!userInfo.instances) userInfo.instances = {};
		const wellknown = this.info.wellknown;
		if(!userInfo.instances[wellknown]){
			const pingRes = await fetch(this.info.api + "/ping");
			const pingJSON = await pingRes.json();
			userInfo.instances[wellknown] = pingJSON;
			localStorage.setItem("userinfos", JSON.stringify(userInfo));
		}
		this.instancePing = userInfo.instances[wellknown].instance;

		this.pageTitle("Loading...");
	}
	pageTitle(channelName = "", guildName = ""){
		(document.getElementById("channelname") as HTMLSpanElement).textContent =
      channelName;
		(
      document.getElementsByTagName("title")[0] as HTMLTitleElement
		).textContent =
      channelName +
      (guildName ? " | " + guildName : "") +
      " | " +
      this.instancePing.name +
      " | Jank Client";
	}
	async instanceStats(){
		const res = await fetch(this.info.api + "/policies/stats", {
			headers: this.headers,
		});
		const json = await res.json();

		const dialog = new Dialog([
			"vdiv",
			["title", "Instance stats: " + this.instancePing.name],
			["text", "Registered users: " + json.counts.user],
			["text", "Servers: " + json.counts.guild],
			["text", "Messages: " + json.counts.message],
			["text", "Members: " + json.counts.members],
		]);
		dialog.show();
	}
}
export{ Localuser };

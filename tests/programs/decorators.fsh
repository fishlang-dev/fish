// mode: parse
@Component({ selector: "app", template: `<div></div>` })
@Injectable()
class App {
  @Input() name: string = ""
  @Output() changed = new EventEmitter()
  @HostListener("click", ["$event"])
  onClick(@Inject(EVENT) event: Event) {}
  @memo get total() { return 1 }
  @(decorators.pick("x")) value = 1
}
let Decorated = @tracked class {}
